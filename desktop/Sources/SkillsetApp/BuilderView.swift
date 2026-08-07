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
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                composer

                if model.isDecomposing {
                    thinking
                } else if !model.builderProposals.isEmpty {
                    results
                } else if model.builderIdea.isEmpty {
                    starters
                }
            }
            .frame(maxWidth: 660)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.top, 28)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.never)
    }

    // MARK: composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What should your agents know?")
                .font(.system(size: 15, weight: .semibold))

            // A vertical TextField carries a real placeholder, so the prompt and
            // the caret share one text container and cannot drift apart.
            TextField(
                "Describe a preference, a workflow, or a correction…",
                text: $model.builderIdea,
                axis: .vertical
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .lineSpacing(2)
            .lineLimit(3...10)
            .focused($ideaFocused)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.primary.opacity(0.045))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(.primary.opacity(ideaFocused ? 0.18 : 0.07))
            )
            .animation(.easeOut(duration: 0.15), value: ideaFocused)

            HStack(spacing: 10) {
                Text("Split into the smallest reusable skills")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.tertiary)

                Spacer(minLength: 8)

                if !model.builderProposals.isEmpty || !model.builderIdea.isEmpty {
                    Button("Clear") { model.clearBuilder() }
                        .buttonStyle(.plain)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task { await model.decompose() }
                } label: {
                    Text("Decompose")
                        .font(.system(size: 11.5, weight: .medium))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
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
        VStack(alignment: .leading, spacing: 6) {
            Text("Try")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 2)

            ForEach(examples, id: \.self) { example in
                Button {
                    model.builderIdea = example
                    ideaFocused = true
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.turn.down.right")
                            .font(.system(size: 9))
                            .foregroundStyle(.quaternary)
                        Text(example)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 5)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 26)
    }

    private var thinking: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Finding the smallest units…")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .padding(.top, 26)
    }

    private var results: some View {
        let installable = model.builderProposals.filter(\.installable).count

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(
                    model.builderProposals.count == 1
                        ? "1 skill"
                        : "\(model.builderProposals.count) skills"
                )
                .font(.system(size: 12, weight: .semibold))

                if let rationale = model.builderRationale, !rationale.isEmpty {
                    Text(rationale)
                        .font(.system(size: 10.5))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Button {
                    Task { await model.installProposals() }
                } label: {
                    if model.isInstallingProposals {
                        ProgressView().controlSize(.mini)
                    } else {
                        Text(installable == 1 ? "Install" : "Install \(installable)")
                            .font(.system(size: 11.5, weight: .medium))
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(installable == 0 || model.isInstallingProposals)
            }

            ForEach(model.builderProposals) { proposal in
                ProposalCard(proposal: proposal)
            }
        }
        .padding(.top, 26)
    }
}

private struct ProposalCard: View {
    let proposal: BuilderProposal
    @State private var expanded = false

    /// Maps the CLI's lowercase kind onto the same labels the Library uses.
    private var kindLabel: String {
        switch proposal.kind {
        case "rule": "Rule"
        case "workflow": "Workflow"
        case "tool": "Tool"
        default: "Judgement"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Text(proposal.name)
                    .font(.system(size: 12.5, weight: .medium))
                KindBadge(kind: kindLabel)
                Spacer(minLength: 4)
                if !proposal.installable {
                    Text("blocked")
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(.orange)
                }
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { expanded.toggle() }
                } label: {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }

            Text(proposal.description)
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !proposal.prevents.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 9))
                        .foregroundStyle(.quaternary)
                        .padding(.top, 1)
                    Text(proposal.prevents)
                        .font(.system(size: 10.5))
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if expanded {
                Text(proposal.body)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }

            if !proposal.links.isEmpty {
                Text(proposal.links.map { "[[\($0)]]" }.joined(separator: "  "))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.quaternary)
            }

            ForEach(proposal.issues, id: \.message) { issue in
                Text(issue.message)
                    .font(.system(size: 10))
                    .foregroundStyle(issue.severity == "error" ? .red : .orange)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.primary.opacity(0.035))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.primary.opacity(0.07))
        )
        .opacity(proposal.installable ? 1 : 0.6)
    }
}
