import SwiftUI

/// The canonical store, seen in one place.
struct LibraryView: View {
    @Bindable var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            SkillListColumn(model: model)
                .frame(width: 276)

            Rectangle()
                .fill(.primary.opacity(0.06))
                .frame(width: 1)

            if let skill = model.selectedSkill {
                SkillDetail(model: model, skill: skill)
                    .id(skill.id)
            } else {
                VStack(spacing: 6) {
                    Text("Nothing here")
                        .font(.system(size: 13, weight: .medium))
                    Text("No skill matches that search.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct SkillListColumn: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            SearchField(text: $model.searchText, count: model.snapshot.skills.count)
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .padding(.bottom, 9)

            KindFilterRow(model: model)
                .padding(.bottom, 9)

            ScrollView {
                LazyVStack(spacing: 1) {
                    ForEach(model.filteredSkills) { skill in
                        Button {
                            model.selectedSkillID = skill.id
                        } label: {
                            SkillRow(skill: skill, isSelected: model.selectedSkillID == skill.id)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 10)
            }
            .scrollIndicators(.never)

            ActivityStrip(model: model)
        }
        .background(.primary.opacity(0.02))
        .onChange(of: model.filteredSkills.map(\.id)) { _, visibleIDs in
            if !visibleIDs.contains(model.selectedSkillID ?? "") {
                model.selectedSkillID = visibleIDs.first
            }
        }
    }
}

private struct SearchField: View {
    @Binding var text: String
    let count: Int
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
            TextField("Search \(count)", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .focused($focused)
            if !text.isEmpty {
                Button {
                    text = ""
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
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(.primary.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(.primary.opacity(focused ? 0.16 : 0))
        )
    }
}

/// Skills are reached for by kind, so the kinds are the filter — always visible,
/// never behind a popover.
private struct KindFilterRow: View {
    @Bindable var model: AppModel

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 4) {
                chip(title: "All", kind: nil)
                ForEach(model.skillCategories, id: \.self) { kind in
                    chip(title: kind, kind: kind)
                }
            }
            .padding(.horizontal, 14)
        }
        .scrollIndicators(.never)
    }

    private func chip(title: String, kind: String?) -> some View {
        let active = model.selectedCategory == kind
        return Button {
            model.selectedCategory = kind
        } label: {
            Text(title)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(active ? .primary : .secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule().fill(.primary.opacity(active ? 0.11 : 0.045))
                )
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }
}

private struct SkillRow: View {
    let skill: SkillRecord
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(SkillKindStyle.color(skill.category))
                .frame(width: 2.5, height: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(skill.name)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Text(skill.description)
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(.primary.opacity(0.075))
            }
        }
        .contentShape(.rect)
    }
}

enum SkillKindStyle {
    static func color(_ kind: String) -> Color {
        switch kind {
        case "Tool": .blue
        case "Workflow": .purple
        case "Judgement": .orange
        case "Rule": .pink
        default: .gray
        }
    }
}

private enum SkillViewMode: String, CaseIterable, Identifiable {
    case read = "Read"
    case write = "Edit"

    var id: String { rawValue }
}

private struct SkillDetail: View {
    @Bindable var model: AppModel
    let skill: SkillRecord

    @State private var mode: SkillViewMode = .read
    @State private var draft: String
    @State private var showDeleteConfirmation = false

    init(model: AppModel, skill: SkillRecord) {
        self.model = model
        self.skill = skill
        _draft = State(initialValue: skill.markdown)
    }

    private var hasChanges: Bool { draft != skill.markdown }

    var body: some View {
        VStack(spacing: 0) {
            header

            Rectangle()
                .fill(.primary.opacity(0.06))
                .frame(height: 1)

            if mode == .read {
                ScrollView {
                    MarkdownReader(markdown: skill.body)
                        .frame(maxWidth: 700, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 20)
                }
                .scrollIndicators(.never)
            } else {
                TextEditor(text: $draft)
                    .font(.system(size: 12, design: .monospaced))
                    .lineSpacing(3)
                    .scrollContentBackground(.hidden)
                    .padding(16)
            }
        }
        .alert("Delete \(skill.name)?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task { await model.deleteSkill(skill) }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Removes it from the store and every connected agent.")
        }
    }

    /// One line of metadata, not three. The kind, how often it has been used,
    /// and whether you touched it — everything else was noise.
    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(skill.name)
                    .font(.system(size: 15, weight: .semibold))
                    .textSelection(.enabled)

                Spacer(minLength: 8)

                Picker("", selection: $mode) {
                    ForEach(SkillViewMode.allCases) { Text($0.rawValue).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .controlSize(.small)
                .frame(width: 108)
            }

            Text(skill.description)
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 7) {
                KindBadge(kind: skill.category)

                if skill.userEdited {
                    Text("edited")
                        .font(.system(size: 10.5))
                        .foregroundStyle(.tertiary)
                }

                Spacer(minLength: 8)

                if mode == .write {
                    Button {
                        Task {
                            if await model.saveSkill(skill, markdown: draft) {
                                draft = model.selectedSkill?.markdown ?? draft
                            }
                        }
                    } label: {
                        if model.savingSkillID == skill.id {
                            ProgressView().controlSize(.mini)
                        } else {
                            Text("Save")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(!hasChanges || model.savingSkillID != nil)
                    .keyboardShortcut("s", modifiers: .command)
                }

                Button {
                    showDeleteConfirmation = true
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .disabled(model.deletingSkillID != nil)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 16)
        .padding(.bottom, 13)
    }
}

struct KindBadge: View {
    let kind: String

    var body: some View {
        Text(kind.lowercased())
            .font(.system(size: 9.5, weight: .medium))
            .foregroundStyle(SkillKindStyle.color(kind))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(SkillKindStyle.color(kind).opacity(0.14)))
    }
}

private struct ActivityStrip: View {
    @Bindable var model: AppModel

    private var liveCount: Int {
        model.snapshot.connections.filter { $0.configured && $0.status == .live }.count
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(liveCount > 0 ? .green : .orange)
                .frame(width: 5, height: 5)
            Text("\(liveCount) agents")
            if let latest = model.snapshot.history.first {
                Text("·").foregroundStyle(.quaternary)
                Text(latest.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
            if model.isRefreshing {
                ProgressView().controlSize(.mini).scaleEffect(0.7)
            }
        }
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .overlay(alignment: .top) {
            Rectangle().fill(.primary.opacity(0.06)).frame(height: 1)
        }
    }
}
