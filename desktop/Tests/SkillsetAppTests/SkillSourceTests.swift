import XCTest
@testable import SkillsetApp

final class SkillSourceTests: XCTestCase {
    func testLinksPathsAndReposAreSources() {
        XCTAssertEqual(SkillSource.detect("  https://github.com/a/b  "), "https://github.com/a/b")
        XCTAssertEqual(SkillSource.detect("~/skills/ship-it"), "~/skills/ship-it")
        XCTAssertEqual(SkillSource.detect("/tmp/ship-it/SKILL.md"), "/tmp/ship-it/SKILL.md")
        XCTAssertEqual(SkillSource.detect("anthropics/skills"), "anthropics/skills")
    }

    func testIdeasAreNotSources() {
        XCTAssertNil(SkillSource.detect(""))
        XCTAssertNil(SkillSource.detect("prefer Arc over Chrome"))
        XCTAssertNil(SkillSource.detect("read https://example.com first"))
        XCTAssertNil(SkillSource.detect("ship-it"))
    }
}
