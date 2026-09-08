import SwiftUI

/// The library: search on top, every skill in the middle, the two ways out at
/// the bottom (make a new skill, open Settings).
struct Sidebar: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            SearchField(model: model)
                .padding(.horizontal, 12)
                .padding(.top, UI.topInset)
                .padding(.bottom, 10)

            SkillList(model: model)

            Footer(model: model)
        }
        .background(SidebarMaterial())
    }
}

private struct SearchField: View {
    @Bindable var model: AppModel
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.secondary)

            TextField(placeholder, text: $model.searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .focused($focused)

            if model.isRefreshing {
                ProgressView()
                    .controlSize(.mini)
            } else if !model.searchText.isEmpty {
                Button {
                    model.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
                .help("Clear search")
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.primary.opacity(focused ? 0.08 : 0.055))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.primary.opacity(focused ? 0.14 : 0.06))
        )
        .animation(.easeOut(duration: 0.12), value: focused)
        .onChange(of: model.searchFocusToken) { _, _ in focused = true }
    }

    private var placeholder: String {
        let count = model.snapshot.skills.count
        return count > 0 ? "Search \(count) skills" : "Search"
    }
}

private struct SkillList: View {
    @Bindable var model: AppModel
    @FocusState private var focused: Bool

    var body: some View {
        List(selection: Binding<String?>(
            get: { model.isBuilding ? nil : model.selectedSkillID },
            set: { if let id = $0 { model.select(id) } }
        )) {
            ForEach(model.filteredSkills) { skill in
                SkillRow(skill: skill)
                    .tag(skill.id)
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.sidebar)
        .focusable()
        .focused($focused)
        .simultaneousGesture(TapGesture().onEnded { focused = true })
        .onMoveCommand { direction in
            let skills = model.filteredSkills
            guard !skills.isEmpty else { return }
            let current = skills.firstIndex { $0.id == model.selectedSkillID } ?? 0
            switch direction {
            case .down: model.select(skills[min(current + 1, skills.count - 1)].id)
            case .up: model.select(skills[max(current - 1, 0)].id)
            default: break
            }
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if model.filteredSkills.isEmpty, !model.snapshot.skills.isEmpty {
                VStack(spacing: 8) {
                    Text("No matches")
                        .font(.system(size: 13, weight: .medium))
                    Button("Clear search") { model.searchText = "" }
                        .buttonStyle(.link)
                }
            }
        }
        .onChange(of: model.filteredSkills.map(\.id)) { _, visibleIDs in
            model.ensureSelection(in: visibleIDs)
        }
    }
}

private struct SkillRow: View {
    let skill: SkillRecord

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "doc.text")
                .font(.system(size: 15))
                .foregroundStyle(SkillKindStyle.color(skill.category))
                .frame(width: 20)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(skill.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                Text(skill.description)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .help(skill.description)
        .accessibilityElement(children: .combine)
    }
}

private struct Footer: View {
    @Bindable var model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            Button {
                model.startBuilding()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                    Text("New skill")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(tone: model.isBuilding ? .accent : .neutral))
            .help("New skill (⌘N)")

            SettingsLink {
                Image(systemName: "gearshape")
            }
            .buttonStyle(IconButtonStyle())
            .help("Settings (⌘,)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .top) { Hairline() }
    }
}
