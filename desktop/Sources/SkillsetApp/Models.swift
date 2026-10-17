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

struct SkillRecord: Equatable, Identifiable {
    let id: String
    let name: String
    let description: String
    let body: String
    let markdown: String
    let origin: String
    let userEdited: Bool
    let category: String
    /// Loads in every session through each agent's global instructions file.
    var always = false
    /// The skill's folder in the canonical store.
    var path = ""
    /// Supporting files next to SKILL.md, relative to `path`.
    var files: [String] = []

    var folderURL: URL { URL(fileURLWithPath: path) }
}

extension SkillRecord: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, name, description, body, markdown, origin, userEdited, category, always, path, files
    }

    /// The last three fields arrived later, so an older backend still decodes.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        description = try c.decode(String.self, forKey: .description)
        body = try c.decode(String.self, forKey: .body)
        markdown = try c.decode(String.self, forKey: .markdown)
        origin = try c.decode(String.self, forKey: .origin)
        userEdited = try c.decode(Bool.self, forKey: .userEdited)
        category = try c.decode(String.self, forKey: .category)
        always = try c.decodeIfPresent(Bool.self, forKey: .always) ?? false
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        files = try c.decodeIfPresent([String].self, forKey: .files) ?? []
    }
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
