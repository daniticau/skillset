import SwiftUI

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
            if !model.alwaysSkills.isEmpty {
                Section("Always On") { rows(model.alwaysSkills) }
            }
            if !model.onDemandSkills.isEmpty {
                Section(model.alwaysSkills.isEmpty ? "Skills" : "On Demand") { rows(model.onDemandSkills) }
            }
        }
        .listStyle(.sidebar)
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

    private func rows(_ skills: [SkillRecord]) -> some View {
        ForEach(skills) { skill in
            SkillRow(skill: skill)
                .tag(skill.id)
                .listRowSeparator(.hidden)
                .contextMenu { SkillMenu(model: model, skill: skill) }
        }
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
        Divider()
        Button("Show in Finder") { model.revealInFinder(skill) }
            .disabled(skill.path.isEmpty)
        Button("Copy Name") { model.copyName(skill) }
        Divider()
        Button("Delete…", role: .destructive) { model.requestDelete(skill) }
    }
}

private struct SkillRow: View {
    let skill: SkillRecord

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: SkillKindStyle.symbol(skill.category))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(SkillKindStyle.color(skill.category))
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(skill.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                Text(skill.description)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .help(skill.description)
        .accessibilityElement(children: .combine)
        .accessibilityHint("\(skill.category), \(skill.always ? "always on" : "on demand")")
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
