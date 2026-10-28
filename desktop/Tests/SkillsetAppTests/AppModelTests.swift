import XCTest
@testable import SkillsetApp

final class AppModelTests: XCTestCase {
    @MainActor
    private static func makeModel() -> AppModel {
        let model = AppModel()
        let skills = ["alpha", "beta"].map { name in
            SkillRecord(id: name, name: name, description: name, body: name,
                        markdown: name, origin: "manual", userEdited: true, category: "Rule")
        }
        model.snapshot = DesktopSnapshot(generatedAt: "", storePath: "", connections: [], skills: skills, history: [])
        model.selectedSkillID = "alpha"
        return model
    }

    func testSearchKeepsDirtyEditorEvenWhenThereAreNoMatches() async {
        await MainActor.run {
            let model = Self.makeModel()
            model.dirtyEditor = true
            model.searchText = "no matching skill"
            model.ensureSelection(in: [])
            XCTAssertEqual(model.selectedSkill?.id, "alpha")
            XCTAssertTrue(model.filteredSkills.isEmpty)
            XCTAssertTrue(model.dirtyEditor)
        }
    }

    func testNavigationWaitsForDiscardAndKeepEditingPreservesSelection() async {
        await MainActor.run {
            let model = Self.makeModel()
            model.dirtyEditor = true
            model.select("beta")
            XCTAssertEqual(model.selectedSkillID, "alpha")
            XCTAssertTrue(model.showDiscardAlert)
            model.keepEditing()
            XCTAssertTrue(model.dirtyEditor)
            XCTAssertEqual(model.selectedSkillID, "alpha")
            model.select("beta")
            model.discardAndContinue()
            XCTAssertEqual(model.selectedSkillID, "beta")
            XCTAssertFalse(model.dirtyEditor)
        }
    }

    func testSavePreventsNavigationAndSearchSelectionChanges() async {
        await MainActor.run {
            let model = Self.makeModel()
            model.savingSkillID = "alpha"
            model.select("beta")
            model.startBuilding()
            model.searchText = "beta"
            model.ensureSelection(in: ["beta"])
            XCTAssertEqual(model.selectedSkill?.id, "alpha")
            XCTAssertFalse(model.isBuilding)
            XCTAssertTrue(model.hasPendingWork)
        }
    }

    func testAlwaysOnSkillsListFirst() async {
        await MainActor.run {
            let model = AppModel()
            var rule = SkillRecord(id: "zulu", name: "zulu", description: "z", body: "z",
                                   markdown: "z", origin: "manual", userEdited: false, category: "Rule")
            rule.always = true
            let tool = SkillRecord(id: "alpha", name: "alpha", description: "a", body: "a",
                                   markdown: "a", origin: "manual", userEdited: false, category: "Tool")
            model.snapshot = DesktopSnapshot(generatedAt: "", storePath: "", connections: [], skills: [tool, rule], history: [])
            XCTAssertEqual(model.visibleSkillIDs, ["zulu", "alpha"])
            XCTAssertEqual(model.selectedSkill?.id, "zulu")
        }
    }

    func testALinkInTheDraftBoxAddsOnlyWhileTheFieldsAreEmpty() async {
        await MainActor.run {
            let model = Self.makeModel()
            XCTAssertFalse(model.hasDraft)
            model.draftBody = "owner/repo"
            XCTAssertTrue(model.hasDraft)
            XCTAssertEqual(model.draftSource, "owner/repo")
            model.draftName = "my-skill"
            XCTAssertNil(model.draftSource)
            model.clearDraft()
            XCTAssertFalse(model.hasDraft)
        }
    }
}
