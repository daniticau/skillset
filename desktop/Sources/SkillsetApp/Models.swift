import Foundation

/// Skillset is two things: one canonical place to see every skill, and a place
/// to build new ones. The navigation says exactly that and nothing else —
/// activity and reports live inside Library as context, not as destinations.
enum SidebarSection: String, CaseIterable, Identifiable {
    case library
    case builder
    case settings

    var id: String { rawValue }

    /// The two primary surfaces. Settings is reachable but is not a peer.
    static var primary: [SidebarSection] { [.library, .builder] }

    var title: String {
        return switch self {
        case .library: "Library"
        case .builder: "Builder"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .library: "square.stack"
        case .builder: "hammer"
        case .settings: "gearshape"
        }
    }
}

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
    static let ids = ["claude-code", "codex", "kimi-code", "grok", "cursor"]

    static func name(for id: String) -> String {
        switch id {
        case "claude-code": "Claude Code"
        case "codex": "Codex"
        case "kimi-code": "Kimi Code"
        case "grok": "Grok CLI"
        case "cursor": "Cursor"
        default: id
        }
    }

    static func shortName(for id: String) -> String {
        switch id {
        case "claude-code": "Claude"
        case "codex": "Codex"
        case "kimi-code": "Kimi"
        case "grok": "Grok"
        case "cursor": "Cursor"
        default: id
        }
    }

    static func symbol(for id: String) -> String {
        switch id {
        case "claude-code": "brain.head.profile"
        case "codex": "chevron.left.forwardslash.chevron.right"
        case "kimi-code": "moon.stars"
        case "grok": "bolt.circle"
        case "cursor": "cursorarrow.rays"
        default: "terminal"
        }
    }
}

struct AppToast: Equatable, Identifiable {
    let id = UUID()
    let message: String
}

enum DisplayDate {
    static func relative(_ value: String?) -> String {
        guard let value, let date = date(from: value) else { return "Never" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func day(_ value: String) -> String {
        guard let date = date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
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
