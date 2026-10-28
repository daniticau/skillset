import SwiftUI

/// A new skill.
///
/// The page is the editor with nothing in it: a name, a description, and a
/// large Markdown box. Paste a SKILL.md and its frontmatter fills the fields;
/// paste a link or a folder and Save becomes Add.
struct NewSkillView: View {
    @Bindable var model: AppModel
    @AppStorage("editorStylesMarkdown") private var stylesMarkdown = true

    private var finalName: String { SkillName.final(model.draftName) }

    private var nameTaken: Bool {
        model.snapshot.skills.contains { $0.id == finalName }
    }

    private var canSave: Bool {
        if model.draftSource != nil { return !model.isMutating }
        return SkillName.isValid(finalName)
            && !nameTaken
            && !model.draftDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !model.isMutating
    }

    var body: some View {
        draft
        .toolbar { actions }
        // On appear too: a draft can hold a paste from before the page closed.
        .task { await model.splitPastedSkill() }
        .onChange(of: model.draftBody) { _, _ in
            Task { await model.splitPastedSkill() }
        }
    }

    // MARK: draft

    private var draft: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                fields
                Hairline()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, UI.pageInset)
            .padding(.top, UI.pageTop)
            .modifier(ScrollBarGutter())

            MarkdownTextView(text: $model.draftBody, styled: stylesMarkdown, focusOnAppear: true)
                .overlay(alignment: .topLeading) {
                    if model.draftBody.isEmpty {
                        Text("Paste a SKILL.md or a link to one, or write the skill here in Markdown.")
                            .font(.reading)
                            .foregroundStyle(.tertiary)
                            .padding(.leading, UI.pageInset)
                            .padding(.top, UI.bodyTop)
                            .allowsHitTesting(false)
                    }
                }
                .disabled(model.isCreating)
        }
    }

    /// The same fields, in the same places, as editing a skill.
    private var fields: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("new-skill", text: $model.draftName)
                .textFieldStyle(.plain)
                .font(.pageTitle)
                .onChange(of: model.draftName) { _, value in
                    let normalised = SkillName.typing(value)
                    if normalised != value { model.draftName = normalised }
                }
                .modifier(FieldChrome(active: true))

            TextField(
                "When should an agent reach for this skill?",
                text: $model.draftDescription,
                axis: .vertical
            )
            .textFieldStyle(.plain)
            .font(.pageSummary)
            .lineLimit(1...6)
            .modifier(FieldChrome(active: true))

            if nameTaken {
                Text("A skill with this name already exists.")
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 8)
            }
        }
        .disabled(model.isCreating)
        // The field chrome pads the text by 8pt; pull it back so the name
        // lines up with the body below.
        .padding(.horizontal, -8)
        .padding(.bottom, 16)
    }

    @ToolbarContentBuilder
    private var actions: some ToolbarContent {
        if !model.snapshot.skills.isEmpty {
            ToolbarItem(placement: .primaryAction) {
                Button("Close") { model.stopBuilding() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(model.isMutating)
            }

            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
        }

        ToolbarItem(placement: .confirmationAction) {
            Button {
                if let source = model.draftSource {
                    Task { await model.addSkill(from: source) }
                } else {
                    Task { await model.createSkill() }
                }
            } label: {
                if model.isCreating || (model.isAddingSource && model.draftSource != nil) {
                    ProgressView().controlSize(.small)
                } else {
                    Text(model.draftSource == nil ? "Save" : "Add")
                }
            }
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!canSave)
        }
    }
}
