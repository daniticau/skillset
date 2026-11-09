import SwiftUI
import UniformTypeIdentifiers

/// The library: the system search field on top, every skill in the middle, the
/// two ways out at the bottom (make a new skill, open Settings).
struct Sidebar: View {
    @Bindable var model: AppModel

    var body: some View {
        SkillList(model: model)
            .searchable(text: $model.searchText, placement: .sidebar, prompt: "Search")
            .modifier(SearchFocus(token: model.searchFocusToken))
            .modifier(BottomBar { Footer(model: model) })
    }
}

/// ⌘F moves the caret to the search field.
private struct SearchFocus: ViewModifier {
    let token: Int
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        if #available(macOS 15.0, *) {
            content
                .searchFocused($focused)
                .onChange(of: token) { _, _ in focused = true }
        } else {
            content
        }
    }
}

/// Pins the footer under the list. On macOS 26 the system blurs the rows that
/// scroll beneath it; before that, a rule marks the edge.
private struct BottomBar<Bar: View>: ViewModifier {
    @ViewBuilder var bar: Bar

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content.safeAreaBar(edge: .bottom, spacing: 0) { bar }
        } else {
            content.safeAreaInset(edge: .bottom, spacing: 0) {
                bar
                    .background(.bar)
                    .overlay(alignment: .top) { Hairline() }
            }
        }
    }
}

private struct SkillList: View {
    @Bindable var model: AppModel

    var body: some View {
        List(selection: Binding<String?>(
            get: { model.isBuilding ? nil : model.selectedSkillID },
            set: { if let id = $0 { model.select(id) } }
        )) {
            // Headers are rows, not Section headers: a sidebar Section keeps a
            // fixed gap around its header, which spreads collapsed groups apart.
            ForEach(Array(model.skillGroups.enumerated()), id: \.element.id) { index, group in
                GroupHeader(model: model, group: group)
                    .padding(.top, gap(before: index))
                    .selectionDisabled()
                    .listRowSeparator(.hidden)
                if model.isExpanded(group.name) { rows(group.skills) }
            }
        }
        .listStyle(.sidebar)
        .environment(\.sidebarRowSize, .small)
        .environment(\.defaultMinListRowHeight, 16)
        // A group dropped on a skill row lands where it is now, instead of
        // flying back to where the drag began.
        .onDrop(of: [.text], isTargeted: nil) { _ in
            guard model.draggingGroup != nil else { return false }
            model.endGroupDrag()
            return true
        }
        .overlay {
            if model.filteredSkills.isEmpty, !model.snapshot.skills.isEmpty {
                VStack(spacing: 6) {
                    Text("No matches")
                        .font(.system(size: 13, weight: .medium))
                    Button("Clear Search") { model.searchText = "" }
                        .buttonStyle(.link)
                }
            }
        }
        .onChange(of: model.visibleSkillIDs) { _, visibleIDs in
            model.ensureSelection(in: visibleIDs)
        }
    }

    /// Space above a header: some after an open group's last skill, none
    /// after a collapsed group, so folded groups stack tight.
    private func gap(before index: Int) -> CGFloat {
        let groups = model.skillGroups
        guard index > 0 else { return 0 }
        return model.isExpanded(groups[index - 1].name) ? UI.groupGap : 0
    }

    private func rows(_ skills: [SkillRecord]) -> some View {
        ForEach(skills) { skill in
            SkillRow(skill: skill)
                .tag(skill.id)
                .listRowSeparator(.hidden)
                .contextMenu { SkillMenu(model: model, skill: skill) }
        }
    }
}

/// A group's title. A click folds the group away or opens it. A drag moves
/// it: the other groups make room as it passes over them.
private struct GroupHeader: View {
    @Bindable var model: AppModel
    let group: SkillGroup

    private var expanded: Bool { model.isExpanded(group.name) }

    var body: some View {
        HStack(spacing: 6) {
            Text(group.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 4)
            if !expanded {
                Text("\(group.skills.count)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(expanded ? 90 : 0))
        }
        .contentShape(.rect)
        .opacity(model.draggingGroup == group.name ? 0.4 : 1)
        // Simultaneous, so a press held before a drag still starts the drag.
        .simultaneousGesture(TapGesture().onEnded {
            withAnimation(.smooth(duration: 0.25)) { model.toggleGroup(group.name) }
        })
        .onDrag {
            model.beginGroupDrag(group.name)
            return NSItemProvider(object: group.name as NSString)
        } preview: {
            Text(group.name)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.regularMaterial, in: .capsule)
        }
        .onDrop(of: [.text], delegate: GroupDropDelegate(model: model, target: group.name))
        .help(expanded ? "Click to hide these skills. Drag to move the group." : "Click to show these skills. Drag to move the group.")
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(expanded ? "expanded" : "collapsed")
        .accessibilityAction { model.toggleGroup(group.name) }
    }
}

/// Moves the dragged group as soon as it enters another group's header, so
/// the list reorders under the pointer instead of jumping on release.
private struct GroupDropDelegate: DropDelegate {
    let model: AppModel
    let target: String

    func validateDrop(info: DropInfo) -> Bool {
        model.draggingGroup != nil
    }

    func dropEntered(info: DropInfo) {
        guard let dragged = model.draggingGroup else { return }
        withAnimation(.smooth(duration: 0.28)) { model.dragGroup(dragged, over: target) }
    }

    func dropExited(info: DropInfo) {
        model.leaveGroupHeader(target)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        model.endGroupDrag()
        return true
    }
}

/// Moves a skill to another sidebar group. Agents pick the category when they
/// write a skill; this is the hand override.
struct CategoryMenu: View {
    @Bindable var model: AppModel
    let skill: SkillRecord

    var body: some View {
        Menu("Category") {
            ForEach(model.categoryNames, id: \.self) { name in
                Toggle(name, isOn: Binding(
                    get: { skill.category == name },
                    set: { on in Task { await model.setCategory(skill, to: on ? name : nil) } }
                ))
            }
            if skill.category != nil {
                Divider()
                Button("No Category") { Task { await model.setCategory(skill, to: nil) } }
            }
        }
        .disabled(model.isMutating)
    }
}

/// The actions on one skill. The sidebar's context menu and the toolbar's
/// More menu both use it, so the two never drift apart.
struct SkillMenu: View {
    @Bindable var model: AppModel
    let skill: SkillRecord

    var body: some View {
        Button("Edit") { model.edit(skill) }
        Toggle("Always On", isOn: Binding(
            get: { skill.always },
            set: { on in Task { await model.setAlways(skill, on: on) } }
        ))
        CategoryMenu(model: model, skill: skill)
        Divider()
        Button("Show in Finder") { model.revealInFinder(skill) }
            .disabled(skill.path.isEmpty)
        Button("Copy Name") { model.copyName(skill) }
        Divider()
        Button("Delete…", role: .destructive) { model.requestDelete(skill) }
    }
}

/// One line per skill: its kind's symbol and its name. The description shows
/// on hover and in the detail pane, so the list stays compact.
private struct SkillRow: View {
    let skill: SkillRecord

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: SkillKindStyle.symbol(skill.kind))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(SkillKindStyle.color(skill.kind))
                .frame(width: 16)

            Text(skill.name)
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .help(skill.description)
        .accessibilityElement(children: .combine)
        .accessibilityHint("\(skill.kind), \(skill.always ? "always on" : "on demand")")
    }
}

private struct Footer: View {
    @Bindable var model: AppModel

    var body: some View {
        HStack(spacing: 4) {
            Button {
                model.startBuilding()
            } label: {
                Label("New Skill", systemImage: "plus")
            }
            .buttonStyle(PillButtonStyle(tone: model.isBuilding ? .accent : .neutral))
            .help("New Skill (⌘N)")

            Spacer(minLength: 8)

            if model.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .padding(.trailing, 4)
            }

            SettingsLink {
                Image(systemName: "gearshape")
            }
            .buttonStyle(IconButtonStyle())
            .help("Settings (⌘,)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}
