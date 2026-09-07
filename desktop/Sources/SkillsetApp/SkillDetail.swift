import SwiftUI

/// One skill: read it, or edit all three things an agent sees — the name it is
/// loaded by, the description that decides when it loads, and the body.
struct SkillDetail: View {
    @Bindable var model: AppModel
    let skill: SkillRecord

    @AppStorage("editorStylesMarkdown") private var stylesMarkdown = true
    @State private var editing = false
    @State private var draftName: String
    @State private var draftDescription: String
    @State private var draftBody: String
    @State private var showDeleteConfirmation = false

    init(model: AppModel, skill: SkillRecord) {
        self.model = model
        self.skill = skill
        _draftName = State(initialValue: skill.name)
        _draftDescription = State(initialValue: skill.description)
        _draftBody = State(initialValue: skill.body)
    }

    private var finalName: String { SkillName.final(draftName) }

    private var trimmedDescription: String {
        draftDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasChanges: Bool {
        editing && (
            finalName != skill.id
                || trimmedDescription != skill.description
                || draftBody.trimmingCharacters(in: .whitespacesAndNewlines) != skill.body
        )
    }

    private var canSave: Bool {
        hasChanges
            && SkillName.isValid(finalName)
            && !trimmedDescription.isEmpty
            && model.savingSkillID == nil
    }

    var body: some View {
        VStack(spacing: 0) {
            WindowDragArea()
                .frame(height: UI.topInset)

            header

            Hairline()

            if editing {
                MarkdownTextView(text: $draftBody, styled: stylesMarkdown)
            } else {
                ScrollView {
                    MarkdownReader(markdown: skill.body)
                        .frame(maxWidth: UI.columnWidth, alignment: .leading)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, UI.pageInset)
                        .padding(.vertical, 22)
                }
            }
        }
        .onChange(of: hasChanges) { _, dirty in model.dirtyEditor = dirty }
        .onChange(of: model.editRequestToken) { _, _ in
            if !editing { beginEditing() }
        }
        .onDisappear { model.dirtyEditor = false }
        .alert("Delete \(skill.name)?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task { await model.deleteSkill(skill) }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Removes it from the library and from every connected agent.")
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                if editing {
                    TextField("skill-name", text: $draftName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 21, weight: .semibold))
                        .onChange(of: draftName) { _, value in
                            let normalised = SkillName.typing(value)
                            if normalised != value { draftName = normalised }
                        }
                        .modifier(FieldChrome(active: true))

                    TextField(
                        "When should an agent reach for this skill?",
                        text: $draftDescription,
                        axis: .vertical
                    )
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .lineLimit(1...6)
                    .modifier(FieldChrome(active: true))
                } else {
                    Text(skill.name)
                        .font(.system(size: 21, weight: .semibold))
                        .textSelection(.enabled)
                        .modifier(FieldChrome(active: false))

                    Text(skill.description)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .modifier(FieldChrome(active: false))
                }
            }
            // The field chrome pads the text by 8pt; pull it back so the title
            // lines up with the body below in both modes.
            .padding(.horizontal, -8)

            Spacer(minLength: 12)

            actions
                .padding(.top, 5)
        }
        .frame(maxWidth: UI.columnWidth)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, UI.pageInset)
        .padding(.top, 2)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: 6) {
            if editing {
                Button("Cancel") { cancelEditing() }
                    .buttonStyle(PillButtonStyle())

                Button {
                    save()
                } label: {
                    if model.savingSkillID == skill.id {
                        ProgressView().controlSize(.mini)
                            .frame(width: 30)
                    } else {
                        Text("Save")
                    }
                }
                .buttonStyle(PillButtonStyle(tone: .prominent))
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!canSave)
            } else {
                Button {
                    beginEditing()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .buttonStyle(PillButtonStyle())
                .help("Edit (⌘E)")

                Button {
                    showDeleteConfirmation = true
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(IconButtonStyle(tone: .destructive))
                .disabled(model.deletingSkillID != nil)
                .help("Delete skill")
            }
        }
    }

    private func beginEditing() {
        draftName = skill.name
        draftDescription = skill.description
        draftBody = skill.body
        withAnimation(.easeOut(duration: 0.15)) { editing = true }
    }

    private func cancelEditing() {
        withAnimation(.easeOut(duration: 0.15)) { editing = false }
        draftName = skill.name
        draftDescription = skill.description
        draftBody = skill.body
    }

    private func save() {
        guard canSave else { return }
        Task {
            let saved = await model.saveSkill(
                skill,
                name: finalName,
                description: trimmedDescription,
                body: draftBody
            )
            if saved { editing = false }
        }
    }
}
