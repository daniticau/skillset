import XCTest
@testable import SkillsetApp

final class SkillNameTests: XCTestCase {
    func testTypingLowercasesAndJoinsWordsWithSingleHyphens() {
        XCTAssertEqual(SkillName.typing("My New  Skill"), "my-new-skill")
        XCTAssertEqual(SkillName.typing("iOS_prep/skill"), "ios-prep-skill")
    }

    func testTypingKeepsATrailingHyphenSoTypingCanContinue() {
        XCTAssertEqual(SkillName.typing("ship-"), "ship-")
        XCTAssertEqual(SkillName.typing("ship "), "ship-")
    }

    func testTypingNeverStartsWithAHyphen() {
        XCTAssertEqual(SkillName.typing("  -ship"), "ship")
    }

    func testFinalTrimsTrailingHyphens() {
        XCTAssertEqual(SkillName.final("ship it--"), "ship-it")
        XCTAssertEqual(SkillName.final("---"), "")
    }

    func testValidity() {
        XCTAssertTrue(SkillName.isValid("ship-it"))
        XCTAssertFalse(SkillName.isValid(""))
        XCTAssertFalse(SkillName.isValid("ship-"))
        XCTAssertFalse(SkillName.isValid("Ship"))
    }
}
