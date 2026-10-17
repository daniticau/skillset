import Foundation

/// Tells a link or a folder apart from an idea, so the New Skill page can add
/// a skill from where it lives instead of building one from text.
///
/// The CLI decides what a source really holds. This only decides which button
/// the page shows: one token with no spaces, shaped like a URL, a path, or
/// `owner/repo`.
enum SkillSource {
    static func detect(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        if trimmed.hasPrefix("https://") || trimmed.hasPrefix("http://") { return trimmed }
        if trimmed.hasPrefix("/") || trimmed.hasPrefix("~/") { return trimmed }
        if trimmed.range(of: #"^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil {
            return trimmed
        }
        return nil
    }
}
