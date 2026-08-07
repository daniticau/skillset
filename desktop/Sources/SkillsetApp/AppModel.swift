import Foundation
import Observation
import SwiftUI

@MainActor
@Observable
final class AppModel {
    var snapshot = DesktopSnapshot.empty
    var section: SidebarSection = .library
    var selectedSkillID: String?
    var searchText = ""
    var selectedCategory: String?
    var isRefreshing = false
    var savingSkillID: String?
    var deletingSkillID: String?
    var busyConnectionID: String?
    var builderIdea = ""
    var builderProposals: [BuilderProposal] = []
    var builderRationale: String?
    var isDecomposing = false
    var isInstallingProposals = false
    var toast: AppToast?
    var errorMessage: String?

    private let bridge = SkillsetBridge()

    var filteredSkills: [SkillRecord] {
        ranked(snapshot.skills, query: searchText) { skill in
            [
                skill.name,
                skill.description,
                skill.body,
                skill.category,
            ]
        }.filter {
            selectedCategory == nil || $0.category == selectedCategory
        }
    }


    var skillCategories: [String] {
        let categories = Set(snapshot.skills.map(\.category))
        return categories.sorted { lhs, rhs in
            if lhs == "Other" { return false }
            if rhs == "Other" { return true }
            return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
        }
    }

    var hasActiveSkillFilter: Bool {
        selectedCategory != nil
    }


    var selectedSkill: SkillRecord? {
        guard let selectedSkillID else { return filteredSkills.first }
        return filteredSkills.first { $0.id == selectedSkillID } ?? filteredSkills.first
    }

    func refresh(showSpinner: Bool = true) async {
        if showSpinner { isRefreshing = true }
        defer { isRefreshing = false }
        do {
            snapshot = try await bridge.snapshot()
            if !filteredSkills.contains(where: { $0.id == selectedSkillID }) {
                selectedSkillID = filteredSkills.first?.id
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }




    func saveSkill(_ skill: SkillRecord, markdown: String) async -> Bool {
        savingSkillID = skill.id
        defer { savingSkillID = nil }
        do {
            try await bridge.saveSkill(name: skill.id, markdown: markdown)
            await refresh(showSpinner: false)
            showToast("\(skill.name) saved")
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
            selectedSkillID = nil
            await refresh(showSpinner: false)
            showToast("\(skill.name) deleted")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func performConnectionAction(_ connection: Connection) async {
        busyConnectionID = connection.id
        defer { busyConnectionID = nil }
        do {
            if !connection.configured {
                try await bridge.connect(connection)
                showToast("\(connection.name) connected")
            } else if connection.status == .live {
                try await bridge.disconnect(connection)
                showToast("\(connection.name) disconnected")
            } else {
                try await bridge.repairConnections()
                showToast("\(connection.name) reconnected")
            }
            await refresh(showSpinner: false)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearSkillFilters() {
        selectedCategory = nil
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
            let itemFields = fields(item)
            if let score = SearchMatcher.score(query: trimmedQuery, fields: itemFields) {
                scored.append((item, score, index))
            }
        }
        return scored.sorted { lhs, rhs in
            lhs.1 == rhs.1 ? lhs.2 < rhs.2 : lhs.1 > rhs.1
        }
        .map(\.0)
    }

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
                toast = AppToast(message: "No new skill proposed")
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
            await refresh(showSpinner: false)
            toast = AppToast(
                message: "Built \(installable.count) skill\(installable.count == 1 ? "" : "s")"
            )
            section = .library
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
