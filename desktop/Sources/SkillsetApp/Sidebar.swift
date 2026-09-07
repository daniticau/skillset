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
                .font(.system(size: 12.5))
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

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 3) {
                ForEach(model.filteredSkills) { skill in
                    SkillRow(
                        skill: skill,
                        isSelected: !model.isBuilding && model.selectedSkillID == skill.id
                    ) {
                        model.select(skill.id)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 12)

            if model.filteredSkills.isEmpty, !model.snapshot.skills.isEmpty {
                Text("No matches")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 24)
            }
        }
        .onChange(of: model.filteredSkills.map(\.id)) { _, visibleIDs in
            model.ensureSelection(in: visibleIDs)
        }
    }
}

/// Colour says what kind of knowledge a skill holds. It tints the whole row,
/// faintly, and deepens for the selected one.
private struct SkillRow: View {
    let skill: SkillRecord
    let isSelected: Bool
    let action: () -> Void
    @State private var hovered = false

    private var kindColor: Color { SkillKindStyle.color(skill.category) }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(skill.name)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                Text(skill.description)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(kindColor.opacity(isSelected ? 0.22 : hovered ? 0.14 : 0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(kindColor.opacity(isSelected ? 0.35 : 0))
            )
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .animation(.easeOut(duration: 0.12), value: hovered)
        .animation(.easeOut(duration: 0.12), value: isSelected)
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
