import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
final class AppModel {
    var snapshot = DesktopSnapshot.empty
    var selectedSkillID: String?
    /// The detail pane shows the builder instead of a skill.
    var isBuilding = false
    var searchText = ""
    var searchFocusToken = 0
    /// Bumped by the Edit Skill command; the open skill switches to edit mode.
    var editRequestToken = 0
    var isRefreshing = false
    var savingSkillID: String?
    var deletingSkillID: String?
    var busyConnectionID: String?
    /// The open editor holds changes that are not saved yet.
    var dirtyEditor = false
    var showDiscardAlert = false
    var builderIdea = ""
    var builderProposals: [BuilderProposal] = []
    var builderRationale: String?
    var isDecomposing = false
    var isInstallingProposals = false
    var toast: AppToast?
    var errorMessage: String?

    private enum PendingNavigation {
        case select(String)
        case build
    }

    private var pending: PendingNavigation?
    private let bridge = SkillsetBridge()

    var filteredSkills: [SkillRecord] {
        ranked(snapshot.skills, query: searchText) { skill in
            [skill.name, skill.description, skill.body]
        }
    }

    var selectedSkill: SkillRecord? {
        guard let selectedSkillID else { return filteredSkills.first }
        return filteredSkills.first { $0.id == selectedSkillID } ?? filteredSkills.first
    }

    // MARK: navigation

    func select(_ id: String) {
        guard id != selectedSkillID || isBuilding else { return }
        if dirtyEditor {
            pending = .select(id)
            showDiscardAlert = true
            return
        }
        selectedSkillID = id
        isBuilding = false
    }

    func startBuilding() {
        guard !isBuilding else { return }
        if dirtyEditor {
            pending = .build
            showDiscardAlert = true
            return
        }
        isBuilding = true
    }

    func stopBuilding() {
        isBuilding = false
    }

    func discardAndContinue() {
        dirtyEditor = false
        showDiscardAlert = false
        guard let pending else { return }
        self.pending = nil
        switch pending {
        case .select(let id):
            selectedSkillID = id
            isBuilding = false
        case .build:
            isBuilding = true
        }
    }

    func keepEditing() {
        pending = nil
        showDiscardAlert = false
    }

    /// Keeps a selection that the search just filtered out from pointing at nothing.
    func ensureSelection(in visibleIDs: [String]) {
        guard !dirtyEditor, !visibleIDs.contains(selectedSkillID ?? "") else { return }
        selectedSkillID = visibleIDs.first
    }

    func requestSearchFocus() {
        searchFocusToken += 1
    }

    func requestEdit() {
        guard !isBuilding, selectedSkill != nil else { return }
        editRequestToken += 1
    }

    // MARK: data

    func refresh(showSpinner: Bool = true) async {
        if showSpinner { isRefreshing = true }
        defer { isRefreshing = false }
        do {
            snapshot = try await bridge.snapshot()
            if !dirtyEditor, !filteredSkills.contains(where: { $0.id == selectedSkillID }) {
                selectedSkillID = filteredSkills.first?.id
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveSkill(_ skill: SkillRecord, name: String, description: String, body: String) async -> Bool {
        savingSkillID = skill.id
        defer { savingSkillID = nil }
        do {
            try await bridge.saveSkill(
                name: skill.id,
                rename: name == skill.id ? nil : name,
                description: description,
                body: body
            )
            dirtyEditor = false
            selectedSkillID = name
            await refresh(showSpinner: false)
            showToast(name == skill.id ? "Saved" : "Saved as \(name)")
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func deleteSkill(_ skill: SkillRecord) async {
        deletingSkillID = skill.id
        defer { deletingSkillID = nil }
        do {
            try await bridge.deleteSkill(name: skill.id)
            dirtyEditor = false
            selectedSkillID = nil
            await refresh(showSpinner: false)
            showToast("\(skill.name) deleted")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func connect(_ connection: Connection) async {
        await withConnection(connection) {
            try await bridge.connect(connection)
            showToast("\(connection.name) connected")
        }
    }

    func disconnect(_ connection: Connection) async {
        await withConnection(connection) {
            try await bridge.disconnect(connection)
            showToast("\(connection.name) disconnected")
        }
    }

    func repair(_ connection: Connection) async {
        await withConnection(connection) {
            try await bridge.repairConnections()
            showToast("\(connection.name) repaired")
        }
    }

    private func withConnection(_ connection: Connection, _ work: () async throws -> Void) async {
        busyConnectionID = connection.id
        defer { busyConnectionID = nil }
        do {
            try await work()
            await refresh(showSpinner: false)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func showToast(_ message: String) {
        let next = AppToast(message: message)
        withAnimation(.snappy(duration: 0.24)) { toast = next }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.4))
            guard toast?.id == next.id else { return }
            withAnimation(.easeInOut(duration: 0.2)) { toast = nil }
        }
    }

    private func ranked<Item>(_ items: [Item], query: String, fields: (Item) -> [String]) -> [Item] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var scored: [(item: Item, score: Int, index: Int)] = []
        for (index, item) in items.enumerated() {
            if let score = SearchMatcher.score(query: trimmedQuery, fields: fields(item)) {
                scored.append((item, score, index))
            }
        }
        return scored.sorted { lhs, rhs in
            lhs.score == rhs.score ? lhs.index < rhs.index : lhs.score > rhs.score
        }
        .map(\.item)
    }

    // MARK: builder

    func decompose() async {
        let idea = builderIdea.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !idea.isEmpty, !isDecomposing else { return }
        isDecomposing = true
        builderProposals = []
        builderRationale = nil
        defer { isDecomposing = false }
        do {
            let response = try await bridge.decompose(idea: idea)
            builderProposals = response.skills
            builderRationale = response.rationale
            if response.skills.isEmpty {
                showToast("No new skill proposed")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func installProposals() async {
        let installable = builderProposals.filter(\.installable)
        guard !installable.isEmpty, !isInstallingProposals else { return }
        isInstallingProposals = true
        defer { isInstallingProposals = false }
        do {
            try await bridge.installProposals(installable)
            clearBuilder()
            selectedSkillID = installable.first?.name
            isBuilding = false
            await refresh(showSpinner: false)
            showToast("Built \(installable.count) skill\(installable.count == 1 ? "" : "s")")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearBuilder() {
        builderIdea = ""
        builderProposals = []
        builderRationale = nil
    }
}
