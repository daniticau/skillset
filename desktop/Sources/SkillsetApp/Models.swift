import Foundation

struct DesktopSnapshot: Decodable, Equatable {
    let generatedAt: String
    let storePath: String
    let connections: [Connection]
    let skills: [SkillRecord]
    let history: [HistoryRecord]

    static let empty = DesktopSnapshot(
        generatedAt: "",
        storePath: "~/.skillset",
        connections: [],
        skills: [],
        history: []
    )
}

struct Connection: Decodable, Equatable, Identifiable {
    enum Status: String, Decodable {
        case live
        case attention
        case offline
    }

    let id: String
    let agent: String
    let name: String
    let path: String
    let configured: Bool
    let status: Status
    let skillCount: Int
    let expectedSkillCount: Int
}

struct SkillRecord: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String
    let body: String
    let markdown: String
    let origin: String
    let userEdited: Bool
    let category: String
}

struct HistoryRecord: Decodable, Equatable, Identifiable {
    let id: String
    let createdAt: String
    let kind: String
    let title: String
    let detail: String
    let skillNames: [String]
    let agents: [String]
    let source: String
}

enum AgentPresentation {
    static func symbol(for id: String) -> String {
        switch id {
        case "claude-code": "brain.head.profile"
        case "codex": "chevron.left.forwardslash.chevron.right"
        case "kimi-code": "moon.stars"
        case "grok": "bolt.circle"
        case "cursor": "cursorarrow.rays"
        case "agents": "square.grid.2x2"
        default: "terminal"
        }
    }
}

struct AppToast: Equatable, Identifiable {
    let id = UUID()
    let message: String
}

/// One proposed skill returned by `sks build --json`, plus the validation
/// verdict the CLI already computed. The app never decides installability
/// itself — that stays a single source of truth in the CLI.
struct BuilderProposal: Codable, Equatable, Identifiable {
    let name: String
    let description: String
    let body: String
    let kind: String
    let trigger: String
    let prevents: String
    let links: [String]
    let tier: String
    let issues: [BuilderIssue]
    let installable: Bool

    var id: String { name }

    /// The Library's capitalised kind label, for the shared colour coding.
    var kindLabel: String {
        switch kind {
        case "rule": "Rule"
        case "workflow": "Workflow"
        case "tool": "Tool"
        default: "Judgement"
        }
    }

    /// Only the fields `sks build --from-json` consumes; verdict fields are
    /// recomputed on install rather than trusted from the client.
    var installPayload: [String: Any] {
        [
            "name": name,
            "description": description,
            "body": body,
            "kind": kind,
            "trigger": trigger,
            "prevents": prevents,
            "links": links,
            "tier": tier,
        ]
    }
}

struct BuilderIssue: Codable, Equatable {
    let severity: String
    let message: String
}

struct BuilderResponse: Codable, Equatable {
    let rationale: String?
    let skills: [BuilderProposal]
}
