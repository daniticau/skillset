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

    func testChangingIdeaInvalidatesPreviouslyReviewedProposals() async {
        await MainActor.run {
            let model = Self.makeModel()
            model.builderIdea = "first idea"
            model.builderProposals = [BuilderProposal(
                name: "first", description: "first", body: "first", kind: "rule",
                trigger: "", prevents: "", links: [], tier: "high", issues: [], installable: true
            )]
            model.builderRationale = "first rationale"
            model.builderIdea = "second idea"
            XCTAssertTrue(model.builderProposals.isEmpty)
            XCTAssertNil(model.builderRationale)
        }
    }
}
