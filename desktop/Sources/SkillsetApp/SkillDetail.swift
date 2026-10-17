import AppKit
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
    /// The body's opening `# Title`, kept out of the editor. See `LeadingTitle`.
    @State private var hiddenTitle: String
    @State private var showCancelConfirmation = false

    init(model: AppModel, skill: SkillRecord) {
        self.model = model
        self.skill = skill
        let split = LeadingTitle.split(skill.body)
        _draftName = State(initialValue: skill.name)
        _draftDescription = State(initialValue: skill.description)
        _draftBody = State(initialValue: split.rest)
        _hiddenTitle = State(initialValue: split.title)
    }

    private var finalName: String { SkillName.final(draftName) }

    private var trimmedDescription: String {
        draftDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The body that is saved: the hidden title, then what the editor holds.
    private var fullBody: String { hiddenTitle + draftBody }

    private var hasChanges: Bool {
        editing && (
            finalName != skill.id
                || trimmedDescription != skill.description
                || fullBody.trimmingCharacters(in: .whitespacesAndNewlines) != skill.body
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
        .onAppear {
            guard model.editOnOpenID == skill.id else { return }
            model.editOnOpenID = nil
            beginEditing()
        }
        .onDisappear { model.dirtyEditor = false }
        .alert("Discard edits?", isPresented: $showCancelConfirmation) {
            Button("Discard", role: .destructive) { cancelEditing() }
            Button("Keep Editing", role: .cancel) { }
        } message: {
            Text("Your edits to this skill are not saved.")
        }
    }

    /// Reading: the header and the body are one page that scrolls under the toolbar.
    private var reader: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                Hairline()
                MarkdownReader(markdown: skill.body, dropsLeadingTitle: true)
                    .padding(.top, UI.bodyTop)
                if !skill.files.isEmpty {
                    SkillFiles(skill: skill)
                        .padding(.top, 36)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, UI.pageInset)
            .padding(.top, UI.pageTop)
            .modifier(ScrollBarGutter())

            MarkdownTextView(text: $draftBody, styled: stylesMarkdown)
                .disabled(model.savingSkillID != nil)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
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
            SkillFacts(skill: skill)
                .padding(.horizontal, 8)
                .padding(.top, 6)
        }
        // The field chrome pads the text by 8pt; pull it back so the title
        // lines up with the body below in both modes.
        .padding(.horizontal, -8)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ToolbarContentBuilder
    private var actions: some ToolbarContent {
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
                Toggle(isOn: Binding(
                    get: { skill.always },
                    set: { on in Task { await model.setAlways(skill, on: on) } }
                )) {
                    Label("Always On", systemImage: skill.always ? "pin.fill" : "pin")
                }
                .help(skill.always
                    ? "Loads in every session. Click to load it only on demand."
                    : "Loads on demand. Click to load it in every session.")
                .disabled(model.isMutating)
            }

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
                    model.requestDelete(skill)
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
        resetDrafts()
        withAnimation(.easeOut(duration: 0.15)) { editing = true }
    }

    private func cancelEditing() {
        model.dirtyEditor = false
        withAnimation(.easeOut(duration: 0.15)) { editing = false }
        resetDrafts()
    }

    private func resetDrafts() {
        let split = LeadingTitle.split(skill.body)
        draftName = skill.name
        draftDescription = skill.description
        draftBody = split.rest
        hiddenTitle = split.title
    }

    private func save() {
        guard canSave else { return }
        Task {
            let saved = await model.saveSkill(
                skill,
                name: finalName,
                description: trimmedDescription,
                body: fullBody
            )
            if saved { editing = false }
        }
    }
}

/// Many skills open their body with `# Title`, a habit from Markdown files.
/// The page already shows the skill's name as its title, so the reader skips
/// that line, and the editor hides it too. Save puts it back unchanged.
enum LeadingTitle {
    /// Splits a first `# Heading` line, and the blank lines after it, from the
    /// rest. `title + rest` is always the original body.
    static func split(_ body: String) -> (title: String, rest: String) {
        let lines = body.split(separator: "\n", omittingEmptySubsequences: false)
        guard let first = lines.first, first.hasPrefix("# ") else { return ("", body) }
        var end = 1
        while end < lines.count, lines[end].trimmingCharacters(in: .whitespaces).isEmpty { end += 1 }
        let title = lines[..<end].joined(separator: "\n") + (end < lines.count ? "\n" : "")
        return (title, lines[end...].joined(separator: "\n"))
    }
}

/// One quiet line under the description: what kind of knowledge the skill
/// holds, and when an agent loads it.
private struct SkillFacts: View {
    let skill: SkillRecord

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: SkillKindStyle.symbol(skill.category))
                .foregroundStyle(SkillKindStyle.color(skill.category))
            Text(skill.category)
            Text("·").foregroundStyle(.tertiary)
            Text(skill.always ? "Loads in every session" : "Loads when the description matches")
        }
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .help(skill.always
            ? "Written into each agent's global instructions file."
            : "Agents read the description and load the body when it fits.")
    }
}

/// The supporting files a skill carries: references, assets, scripts.
/// A click opens one in its default app.
private struct SkillFiles: View {
    let skill: SkillRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Files")
                    .font(.system(size: MarkdownMetrics.heading(2).size, weight: .semibold))
                Spacer()
                Button("Show in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([skill.folderURL])
                }
                .buttonStyle(PillButtonStyle(size: .small))
            }
            .padding(.bottom, 8)

            ForEach(skill.files, id: \.self) { file in
                FileRow(path: file) {
                    NSWorkspace.shared.open(skill.folderURL.appending(path: file))
                }
            }
        }
    }
}

private struct FileRow: View {
    let path: String
    let open: () -> Void
    @State private var hovered = false

    private var symbol: String {
        switch (path as NSString).pathExtension.lowercased() {
        case "md", "txt": "doc.text"
        case "png", "jpg", "jpeg", "gif", "svg", "webp": "photo"
        case "sh", "py", "js", "ts", "mjs", "cjs", "swift": "chevron.left.forwardslash.chevron.right"
        case "html", "css": "globe"
        case "json", "yaml", "yml", "toml": "curlybraces"
        default: "doc"
        }
    }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
                Text(path)
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(hovered ? .primary : .secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: UI.fieldRadius, style: .continuous)
                    .fill(.primary.opacity(hovered ? 0.05 : 0))
            )
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // The hover fill pads the row by 8pt; pull it back onto the column edge.
        .padding(.horizontal, -8)
        .onHover { hovered = $0 }
        .animation(.easeOut(duration: 0.12), value: hovered)
        .help("Open \(path)")
    }
}
