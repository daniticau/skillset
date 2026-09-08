import XCTest
@testable import SkillsetApp

final class SearchMatcherTests: XCTestCase {
    func testHyphenInsensitiveRankedSkillSearchFindsOverlappingWords() {
        let score = SearchMatcher.score(
            query: "AI Space Research",
            fields: ["ai-research-project-evaluation", "Evaluate AI research projects"]
        )

        XCTAssertNotNil(score)
    }

    func testHistoryFieldsUseTheSameNormalizedMatcher() {
        XCTAssertTrue(SearchMatcher.matches(
            query: "Codex skill change",
            fields: ["Saved skill edit", "Changed AI-research-project-evaluation", "Codex"]
        ))
    }

    func testTwoWordQueryRequiresBothMeaningfulWords() {
        XCTAssertFalse(SearchMatcher.matches(
            query: "restored Kimi",
            fields: ["The skill was removed", "Kimi"]
        ))
    }

    func testUnrelatedQueryDoesNotMatch() {
        XCTAssertFalse(SearchMatcher.matches(
            query: "ios simulator release",
            fields: ["ai-research-project-evaluation", "Evaluate AI research projects"]
        ))
    }
    func testLongQueryDoesNotMatchShortBodyWords() {
        XCTAssertNil(SearchMatcher.score(query: "zzzzqqqqvvv", fields: ["Coast", "z flag"]))
        XCTAssertNil(SearchMatcher.score(query: "researchxyz", fields: ["research"]))
        XCTAssertNotNil(SearchMatcher.score(query: "rese", fields: ["research"]))
    }
}
