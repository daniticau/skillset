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
                if model.isExpanded(group.name) { rows(group) }
            }
        }
        .listStyle(.sidebar)
        .environment(\.sidebarRowSize, .small)
        .environment(\.defaultMinListRowHeight, 16)
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

    /// A group's skills. Each row is also a drop target for the group, so a
    /// dragged group can be aimed anywhere over it, not just at its header.
    private func rows(_ group: SkillGroup) -> some View {
        ForEach(group.skills) { skill in
            SkillRow(skill: skill)
                .overlay(alignment: .bottom) {
                    if skill.id == group.skills.last?.id {
                        InsertionLine(visible: model.dropTarget == group.name && model.dropsBelowTarget)
                    }
                }
                .tag(skill.id)
                .listRowSeparator(.hidden)
                .contextMenu { SkillMenu(model: model, skill: skill) }
                .onDrop(of: [.text], delegate: GroupDropDelegate(model: model, target: group.name))
        }
    }
}

/// A group's title. A click on the name, the count, or the arrow folds the
/// group or opens it. A drag moves it: a line marks where it will land.
private struct GroupHeader: View {
    @Bindable var model: AppModel
    let group: SkillGroup

    private var expanded: Bool { model.isExpanded(group.name) }

    var body: some View {
        HStack(spacing: 6) {
            Text(group.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
                // Simultaneous, so a press held before a drag still starts the drag.
                .simultaneousGesture(TapGesture().onEnded(toggle))

            Button(action: toggle) {
                HStack(spacing: 6) {
                    if !expanded {
                        Text("\(group.skills.count)")
                            .font(.system(size: 11))
                            .monospacedDigit()
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .foregroundStyle(.tertiary)
                .padding(.leading, 8)
                .frame(minHeight: 16)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .overlay(alignment: .top) {
            InsertionLine(visible: model.dropTarget == group.name && !model.dropsBelowTarget)
        }
        .overlay(alignment: .bottom) {
            // A folded group's header is its last row.
            if !expanded {
                InsertionLine(visible: model.dropTarget == group.name && model.dropsBelowTarget)
            }
        }
        .opacity(model.draggingGroup == group.name ? 0.4 : 1)
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

    private func toggle() {
        withAnimation(.smooth(duration: 0.25)) { model.toggleGroup(group.name) }
    }
}

/// Where a dragged group will land. It fades in place, so nothing in the
/// list moves until the drop.
private struct InsertionLine: View {
    let visible: Bool

    var body: some View {
        Capsule()
            .fill(Color.accentColor)
            .frame(height: 2)
            .opacity(visible ? 1 : 0)
            .allowsHitTesting(false)
    }
}

/// Marks where the dragged group will land. The move itself waits for the
/// drop: reordering rows under a running drag makes the list reload and jump.
private struct GroupDropDelegate: DropDelegate {
    let model: AppModel
    let target: String

    func validateDrop(info: DropInfo) -> Bool {
        model.draggingGroup != nil
    }

    func dropEntered(info: DropInfo) {
        model.hoverGroup(target)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        model.dropGroup()
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
