import SwiftUI

/// Decomposition-first authoring.
///
/// You write an idea in plain language; Skillset splits it into the smallest
/// reusable units and shows each before anything is written. What you see is
/// exactly what installs — the approved proposal goes back to the CLI rather
/// than the model running twice.
struct BuilderView: View {
    @Bindable var model: AppModel
    @FocusState private var ideaFocused: Bool

    private let examples = [
        "when I say ship it, run tests and typecheck first, then never push to master",
        "always check the frontier before calling a research idea novel",
        "prefer Arc over Chrome, and never launch Helium",
    ]

    var body: some View {
        VStack(spacing: 0) {
            WindowDragArea()
                .frame(height: UI.topInset)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    composer
                        .padding(.top, 22)

                    if model.isDecomposing {
                        thinking
                    } else if !model.builderProposals.isEmpty {
                        results
                    } else if model.builderIdea.isEmpty {
                        starters
                    }
                }
                .frame(maxWidth: UI.columnWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, UI.pageInset)
                .padding(.top, 2)
                .padding(.bottom, 40)
            }
        }
        .onAppear { ideaFocused = true }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("New skill")
                    .font(.system(size: 21, weight: .semibold))
                Text("Say what your agents should know. Skillset splits it into the smallest reusable skills and shows each one before anything is written.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            if !model.snapshot.skills.isEmpty {
                Button("Close") { model.stopBuilding() }
                    .buttonStyle(PillButtonStyle())
                    .padding(.top, 5)
            }
        }
    }

    // MARK: composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            // A vertical TextField carries a real placeholder, so the prompt and
            // the caret share one text container and cannot drift apart.
            TextField(
                "Describe a preference, a workflow, or a correction…",
                text: $model.builderIdea,
                axis: .vertical
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13.5))
            .lineSpacing(3)
            .lineLimit(4...12)
            .focused($ideaFocused)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.primary.opacity(0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(.primary.opacity(ideaFocused ? 0.16 : 0.08))
            )
            .animation(.easeOut(duration: 0.15), value: ideaFocused)

            HStack(spacing: 8) {
                Text("⌘↩ to build")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)

                Spacer(minLength: 8)

                if !model.builderProposals.isEmpty || !model.builderIdea.isEmpty {
                    Button("Clear") { model.clearBuilder() }
                        .buttonStyle(PillButtonStyle())
                }

                Button {
                    Task { await model.decompose() }
                } label: {
                    if model.isDecomposing {
                        ProgressView().controlSize(.mini)
                            .frame(width: 30)
                    } else {
                        Text("Build")
                    }
                }
                .buttonStyle(PillButtonStyle(tone: .prominent))
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(
                    model.builderIdea.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || model.isDecomposing
                )
            }
        }
    }

    // MARK: states

    private var starters: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Try one")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 4)

            ForEach(examples, id: \.self) { example in
                StarterRow(text: example) {
                    model.builderIdea = example
                    ideaFocused = true
                }
            }
        }
        .padding(.top, 28)
    }

    private var thinking: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Finding the smallest units…")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
        }
        .padding(.top, 28)
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
                .disabled(installable == 0 || model.isInstallingProposals)
            }

            ForEach(model.builderProposals) { proposal in
                ProposalCard(proposal: proposal)
            }
        }
        .padding(.top, 28)
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
                    .font(.system(size: 12.5))
                    .foregroundStyle(hovered ? .primary : .secondary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.primary.opacity(hovered ? 0.05 : 0))
            )
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
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
            }

            Text(proposal.description)
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !proposal.prevents.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 9.5))
                        .foregroundStyle(.quaternary)
                        .padding(.top, 2)
                    Text(proposal.prevents)
                        .font(.system(size: 11.5))
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
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(kindColor.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(kindColor.opacity(0.2))
        )
        .opacity(proposal.installable ? 1 : 0.6)
    }
}
