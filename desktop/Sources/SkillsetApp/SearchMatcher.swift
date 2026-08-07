import Foundation

enum SearchMatcher {
    private static let ignoredTokens: Set<String> = [
        "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"
    ]

    /// Returns a relevance score when the query meaningfully overlaps the supplied fields.
    /// Punctuation and separators are normalized, so `ai-research` and `AI research` match.
    static func score(query: String, fields: [String]) -> Int? {
        let queryTokens = tokens(in: query)
        guard !queryTokens.isEmpty else { return 0 }

        let normalizedFields = fields.map(normalize)
        let fieldTokens = Set(normalizedFields.flatMap { $0.split(separator: " ").map(String.init) })
        var matchedTokens = 0
        var score = 0

        for token in queryTokens {
            if fieldTokens.contains(token) {
                matchedTokens += 1
                score += 100
            } else if token.count >= 3,
                      fieldTokens.contains(where: { $0.hasPrefix(token) || token.hasPrefix($0) }) {
                matchedTokens += 1
                score += 72
            }
        }

        let requiredMatches = queryTokens.count >= 2 ? 2 : 1
        guard matchedTokens >= requiredMatches else { return nil }

        let normalizedQuery = normalize(query)
        if normalizedFields.first?.contains(normalizedQuery) == true {
            score += 500
        } else if normalizedFields.dropFirst().contains(where: { $0.contains(normalizedQuery) }) {
            score += 250
        }

        // Prefer compact, high-overlap matches over incidental mentions in long bodies.
        score += matchedTokens * 40
        return score
    }

    static func matches(query: String, fields: [String]) -> Bool {
        score(query: query, fields: fields) != nil
    }

    private static func tokens(in value: String) -> [String] {
        Array(Set(
            normalize(value)
                .split(separator: " ")
                .map(String.init)
                .filter { !ignoredTokens.contains($0) }
        ))
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : " " }
            .reduce(into: "") { $0.append($1) }
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }
}
