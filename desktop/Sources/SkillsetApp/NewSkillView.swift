import SwiftUI

/// A new skill, written or built.
///
/// The page is the editor with nothing in it: a name, a description, and a
/// large Markdown box. Paste a SKILL.md and its frontmatter fills the fields;
/// paste a link or a folder and Save becomes Add. Under the box, an agent can
/// build the skill from a plain description instead. The builder splits it
/// into the smallest reusable skills and shows each before anything installs.
struct NewSkillView: View {
    @Bindable var model: AppModel
    @AppStorage("editorStylesMarkdown") private var stylesMarkdown = true
    @FocusState private var ideaFocused: Bool

    private let examples = [
        "when I say ship it, run tests and typecheck first, then never push to master",
        "always check the frontier before calling a research idea novel",
        "prefer Arc over Chrome, and never launch Helium",
    ]

    private var finalName: String { SkillName.final(model.draftName) }

    private var nameTaken: Bool {
        model.snapshot.skills.contains { $0.id == finalName }
    }

    private var canSave: Bool {
        if model.draftSource != nil { return !model.isMutating && !model.isDecomposing }
        return SkillName.isValid(finalName)
            && !nameTaken
            && !model.draftDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !model.isMutating
            && !model.isDecomposing
    }

    /// The agent's work takes the place of the draft while it runs and while
    /// its proposals wait for review. The draft stays as it was.
    private var showsAgent: Bool {
        model.isDecomposing || !model.builderProposals.isEmpty
            || (model.isAddingSource && model.draftSource == nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsAgent { agentWork } else { draft }
            Hairline()
            builder
        }
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

    // MARK: builder

    /// Describe the skill instead of writing it, and an agent builds it.
    private var builder: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.builderIdea.isEmpty, !showsAgent {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(examples, id: \.self) { example in
                        StarterRow(text: example) {
                            model.builderIdea = example
                            ideaFocused = true
                        }
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                // A vertical TextField carries a real placeholder, so the prompt
                // and the caret share one text container and cannot drift apart.
                TextField(
                    "Or describe the skill, and an agent builds it…",
                    text: $model.builderIdea,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .font(.reading)
                .lineLimit(1...6)
                .focused($ideaFocused)
                .disabled(model.isDecomposing || model.isInstallingProposals || model.isAddingSource)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: UI.cardRadius, style: .continuous)
                        .fill(.primary.opacity(0.04))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: UI.cardRadius, style: .continuous)
                        .stroke(.primary.opacity(ideaFocused ? 0.16 : 0.08))
                )
                .animation(.easeOut(duration: 0.15), value: ideaFocused)

                if !model.builderProposals.isEmpty || !model.builderIdea.isEmpty {
                    Button("Clear") { model.clearBuilder() }
                        .buttonStyle(PillButtonStyle())
                        .disabled(model.isDecomposing || model.isInstallingProposals)
                        .padding(.bottom, 2)
                }

                buildButton
                    .padding(.bottom, 2)
            }
        }
        .padding(.horizontal, UI.pageInset)
        .padding(.top, 12)
        .padding(.bottom, 16)
    }

    /// Build for an idea, Add for a link or a folder. The CLI resolves the link.
    private var buildButton: some View {
        let source = model.builderSource
        let busy = model.isDecomposing || (model.isAddingSource && model.draftSource == nil)
        return Button {
            if let source {
                Task { await model.addSkill(from: source) }
            } else {
                Task { await model.decompose() }
            }
        } label: {
            if busy {
                ProgressView().controlSize(.mini)
                    .frame(width: 30)
            } else {
                Text(source == nil ? "Build" : "Add")
            }
        }
        .buttonStyle(PillButtonStyle(tone: .prominent))
        .keyboardShortcut(.return, modifiers: .command)
        .help(source == nil ? "Build (⌘↩)" : "Add (⌘↩)")
        .disabled(
            model.builderIdea.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || busy || model.isMutating
        )
    }

    // MARK: agent work

    private var agentWork: some View {
        ScrollView {
            Group {
                if model.isAddingSource {
                    progress("Adding the skill…")
                } else if model.isDecomposing {
                    progress("Finding the smallest units…")
                } else {
                    results
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, UI.pageInset)
            .padding(.top, UI.pageTop + 12)
            .padding(.bottom, 24)
        }
        .frame(maxHeight: .infinity)
    }

    private func progress(_ message: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
    }

    private var results: some View {
        let installable = model.builderProposals.filter(\.installable).count

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(
                    model.builderProposals.count == 1
                        ? "1 skill"
                        : "\(model.builderProposals.count) skills"
                )
                .font(.system(size: 13, weight: .semibold))

                if let rationale = model.builderRationale, !rationale.isEmpty {
                    Text(rationale)
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Button {
                    Task { await model.installProposals() }
                } label: {
                    if model.isInstallingProposals {
                        ProgressView().controlSize(.mini)
                            .frame(width: 30)
                    } else {
                        Text(installable == 1 ? "Install" : "Install \(installable)")
                    }
                }
                .buttonStyle(PillButtonStyle(tone: .prominent))
                .disabled(installable == 0 || model.isMutating || model.isDecomposing)
            }

            ForEach(model.builderProposals) { proposal in
                ProposalCard(proposal: proposal)
            }
        }
    }
}

private struct StarterRow: View {
    let text: String
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.quaternary)
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(hovered ? .primary : .secondary)
                    .multilineTextAlignment(.leading)
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
    }
}

/// A proposal, tinted by the kind of knowledge it holds, like a Library row.
private struct ProposalCard: View {
    let proposal: BuilderProposal
    @State private var expanded = false

    private var kindColor: Color { SkillKindStyle.color(proposal.kindLabel) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(proposal.name)
                    .font(.system(size: 13, weight: .medium))
                Spacer(minLength: 4)
                if !proposal.installable {
                    Text("blocked")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(.orange)
                }
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { expanded.toggle() }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .buttonStyle(IconButtonStyle(size: 22))
                .accessibilityLabel(expanded ? "Hide skill content" : "Review skill content")
                .help(expanded ? "Hide skill content" : "Review skill content")
            }

            Text(proposal.description)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !proposal.prevents.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 9.5))
                        .foregroundStyle(.quaternary)
                        .padding(.top, 2)
                    Text(proposal.prevents)
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if expanded {
                MarkdownReader(markdown: proposal.body)
                    .padding(.top, 4)
            }

            ForEach(proposal.issues, id: \.message) { issue in
                Text(issue.message)
                    .font(.system(size: 11))
                    .foregroundStyle(issue.severity == "error" ? .red : .orange)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: UI.cardRadius, style: .continuous)
                .fill(kindColor.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: UI.cardRadius, style: .continuous)
                .stroke(kindColor.opacity(0.2))
        )
        .opacity(proposal.installable ? 1 : 0.6)
    }
}
