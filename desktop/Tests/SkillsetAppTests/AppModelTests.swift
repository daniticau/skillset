import XCTest
@testable import SkillsetApp

final class AppModelTests: XCTestCase {
    @MainActor
    private static func makeModel() -> AppModel {
        let model = AppModel()
        let skills = ["alpha", "beta"].map { name in
            SkillRecord(id: name, name: name, description: name, body: name,
                        markdown: name, origin: "manual", userEdited: true, kind: "Rule")
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
                                   markdown: "z", origin: "manual", userEdited: false, kind: "Rule")
            rule.always = true
            let tool = SkillRecord(id: "alpha", name: "alpha", description: "a", body: "a",
                                   markdown: "a", origin: "manual", userEdited: false, kind: "Tool")
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

    func testGroupsPutSpecialAndAlwaysOnFirstAndFollowTheSavedOrder() async {
        await MainActor.run {
            let defaults = UserDefaults.standard
            let savedOrder = defaults.stringArray(forKey: "sidebarGroupOrder")
            let savedCollapsed = defaults.stringArray(forKey: "sidebarCollapsedGroups")
            defer {
                defaults.set(savedOrder, forKey: "sidebarGroupOrder")
                defaults.set(savedCollapsed, forKey: "sidebarCollapsedGroups")
            }
            defaults.removeObject(forKey: "sidebarGroupOrder")
            defaults.removeObject(forKey: "sidebarCollapsedGroups")

            func record(_ name: String, _ category: String?, always: Bool = false) -> SkillRecord {
                var skill = SkillRecord(id: name, name: name, description: name, body: name,
                                        markdown: name, origin: "manual", userEdited: false, kind: "Workflow")
                skill.category = category
                skill.always = always
                return skill
            }
            let model = AppModel()
            model.snapshot = DesktopSnapshot(generatedAt: "", storePath: "", connections: [], skills: [
                record("loose", nil),
                record("orb", "Design"),
                record("rules", "Writing", always: true),
                record("skillify", "Special"),
                record("tutor", "Learning"),
            ], history: [])

            XCTAssertEqual(model.skillGroups.map(\.name), ["Special", "Always On", "Design", "Learning", "On Demand"])

            model.moveGroup("Learning", to: "Special")
            XCTAssertEqual(model.skillGroups.map(\.name), ["Learning", "Special", "Always On", "Design", "On Demand"])
            XCTAssertEqual(AppModel().groupOrder, model.groupOrder)

            model.toggleGroup("Design")
            XCTAssertFalse(model.isExpanded("Design"))
            XCTAssertTrue(model.visibleSkillIDs.contains("orb"))
            model.searchText = "orb"
            XCTAssertTrue(model.isExpanded("Design"))
        }
    }
}
