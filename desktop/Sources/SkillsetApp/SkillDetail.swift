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
    @State private var showCancelConfirmation = false

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
            && !model.isMutating
            && !model.snapshot.skills.contains { $0.id == finalName && $0.id != skill.id }
    }

    var body: some View {
        Group {
            if editing { editor } else { reader }
        }
        .toolbar { actions }
        .onChange(of: hasChanges) { _, dirty in model.dirtyEditor = dirty }
        .onChange(of: model.editRequestToken) { _, _ in
            if !editing { beginEditing() }
        }
        .onDisappear { model.dirtyEditor = false }
        .alert("Discard edits?", isPresented: $showCancelConfirmation) {
            Button("Discard", role: .destructive) { cancelEditing() }
            Button("Keep Editing", role: .cancel) { }
        } message: {
            Text("Your edits to this skill are not saved.")
        }
        .alert("Delete \(skill.name)?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task { await model.deleteSkill(skill) }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Removes it from the library and from every connected agent.")
        }
    }

    /// Reading: the header and the body are one page that scrolls under the toolbar.
    private var reader: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                Hairline()
                MarkdownReader(markdown: skill.body)
                    .padding(.top, UI.bodyTop)
            }
            .frame(maxWidth: UI.columnWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, UI.pageInset)
            .padding(.top, UI.pageTop)
            .padding(.bottom, 40)
        }
    }

    /// Editing: the fields stay put and the text view scrolls below them.
    private var editor: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                header
                Hairline()
            }
            .frame(maxWidth: UI.columnWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, UI.pageInset)
            .padding(.top, UI.pageTop)
            .modifier(ScrollBarGutter())

            MarkdownTextView(text: $draftBody, styled: stylesMarkdown)
                .disabled(model.savingSkillID != nil)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            if editing {
                TextField("skill-name", text: $draftName)
                    .textFieldStyle(.plain)
                    .font(.pageTitle)
                    .onChange(of: draftName) { _, value in
                        let normalised = SkillName.typing(value)
                        if normalised != value { draftName = normalised }
                    }
                    .modifier(FieldChrome(active: true))
                    .disabled(model.savingSkillID != nil)

                TextField(
                    "When should an agent reach for this skill?",
                    text: $draftDescription,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .font(.pageSummary)
                .lineLimit(1...6)
                .modifier(FieldChrome(active: true))
                .disabled(model.savingSkillID != nil)
            } else {
                Text(skill.name)
                    .font(.pageTitle)
                    .textSelection(.enabled)
                    .modifier(FieldChrome(active: false))

                Text(skill.description)
                    .font(.pageSummary)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .modifier(FieldChrome(active: false))
            }
            if editing, finalName != skill.id,
               model.snapshot.skills.contains(where: { $0.id == finalName }) {
                Text("A skill with this name already exists.")
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 8)
            }
        }
        // The field chrome pads the text by 8pt; pull it back so the title
        // lines up with the body below in both modes.
        .padding(.horizontal, -8)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ToolbarContentBuilder
    private var actions: some ToolbarContent {
        TrailingToolbarSpace()

        if editing {
            ToolbarItem(placement: .primaryAction) {
                Button("Cancel") {
                    if hasChanges { showCancelConfirmation = true }
                    else { cancelEditing() }
                }
                .keyboardShortcut(.cancelAction)
                .disabled(model.savingSkillID != nil)
            }

            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }

            ToolbarItem(placement: .confirmationAction) {
                Button {
                    save()
                } label: {
                    if model.savingSkillID == skill.id {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!canSave)
            }
        } else {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    beginEditing()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .help("Edit (⌘E)")
                .disabled(model.isMutating)
            }

            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }

            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) {
                    showDeleteConfirmation = true
                } label: {
                    Label("Delete", systemImage: "trash")
                        .foregroundStyle(.red)
                }
                .help("Delete skill")
                .disabled(model.isMutating)
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
        model.dirtyEditor = false
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
