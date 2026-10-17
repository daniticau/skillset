import XCTest
@testable import SkillsetApp

final class LeadingTitleTests: XCTestCase {
    func testSplitsTheOpeningTitleAndKeepsTheRest() {
        let split = LeadingTitle.split("# Explicit skills\n\nPick a skill.\n- One")
        XCTAssertEqual(split.title, "# Explicit skills\n\n")
        XCTAssertEqual(split.rest, "Pick a skill.\n- One")
    }

    func testJoiningTheHalvesGivesBackTheBody() {
        for body in ["# A\n\nBody", "# A", "# A\n", "# A\n\n\n## B\ntext", "No title", "## Not a level-one title\n\nx", ""] {
            let split = LeadingTitle.split(body)
            XCTAssertEqual(split.title + split.rest, body)
        }
    }

    func testLeavesABodyWithoutATitleAlone() {
        XCTAssertEqual(LeadingTitle.split("## Section\n\ntext").title, "")
        XCTAssertEqual(LeadingTitle.split("#hashtag").title, "")
    }
}
