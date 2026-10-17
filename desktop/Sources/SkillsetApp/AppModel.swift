import AppKit
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
    /// A skill the detail pane should open in edit mode once it appears.
    var editOnOpenID: String?
    var isRefreshing = false
    var savingSkillID: String?
    var deletingSkillID: String?
    var togglingAlwaysID: String?
    var isAddingSource = false
    /// The skill waiting on the delete confirmation.
    var pendingDelete: SkillRecord?
    var busyConnectionID: String?
    /// The open editor holds changes that are not saved yet.
    var dirtyEditor = false
    var showDiscardAlert = false
    var builderIdea = "" {
        didSet {
            guard builderIdea != oldValue else { return }
            builderProposals = []
            builderRationale = nil
        }
    }
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
    /// The last refresh. Each new one waits for it, so reads land in order.
    private var refreshChain: Task<Void, Never>?
    private var watcher: StoreWatcher?

    var isMutating: Bool {
        savingSkillID != nil || deletingSkillID != nil || togglingAlwaysID != nil
            || isInstallingProposals || isAddingSource || busyConnectionID != nil
    }

    var hasPendingWork: Bool { dirtyEditor || isMutating }


    var filteredSkills: [SkillRecord] {
        ranked(snapshot.skills, query: searchText) { skill in
            [skill.name, skill.description, skill.body]
        }
    }

    /// The sidebar's two groups: rules that load in every session, then the
    /// skills an agent loads when the description matches.
    var alwaysSkills: [SkillRecord] { filteredSkills.filter(\.always) }
    var onDemandSkills: [SkillRecord] { filteredSkills.filter { !$0.always } }

    /// Sidebar order, which search ranking and the two groups both shape.
    var visibleSkillIDs: [String] { (alwaysSkills + onDemandSkills).map(\.id) }

    /// The New Skill page holds a link or a folder, not an idea.
    var builderSource: String? { SkillSource.detect(builderIdea) }

    var selectedSkill: SkillRecord? {
        let first = visibleSkillIDs.first.flatMap(skill(_:))
        guard let selectedSkillID else { return first }
        if dirtyEditor || savingSkillID != nil {
            return skill(selectedSkillID)
        }
        return filteredSkills.first { $0.id == selectedSkillID } ?? first
    }

    func skill(_ id: String) -> SkillRecord? {
        snapshot.skills.first { $0.id == id }
    }

    // MARK: navigation

    func select(_ id: String) {
        guard !isMutating, id != selectedSkillID || isBuilding else { return }
        if dirtyEditor {
            pending = .select(id)
            showDiscardAlert = true
            return
        }
        selectedSkillID = id
        isBuilding = false
    }

    func startBuilding() {
        guard !isMutating, !isBuilding else { return }
        if dirtyEditor {
            pending = .build
            showDiscardAlert = true
            return
        }
        isBuilding = true
    }

    func stopBuilding() {
        guard !isMutating else { return }
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
        guard !dirtyEditor, !isMutating, !visibleIDs.contains(selectedSkillID ?? "") else { return }
        selectedSkillID = visibleIDs.first
    }

    func requestSearchFocus() {
        searchFocusToken += 1
    }

    func requestEdit() {
        guard !isMutating, !isBuilding, selectedSkill != nil else { return }
        editRequestToken += 1
    }

    /// Opens a skill straight into edit mode, from the sidebar's menu.
    func edit(_ skill: SkillRecord) {
        guard !isMutating else { return }
        if skill.id == selectedSkill?.id, !isBuilding {
            requestEdit()
            return
        }
        select(skill.id)
        if selectedSkillID == skill.id, !isBuilding { editOnOpenID = skill.id }
    }

    // MARK: data

    /// Reads the library. A refresh queued behind another runs after it, so a
    /// save always sees data read after the save.
    func refresh(showSpinner: Bool = true) async {
        let previous = refreshChain
        let next = Task { [weak self] in
            await previous?.value
            await self?.load(showSpinner: showSpinner)
        }
        refreshChain = next
        await next.value
    }

    /// Starts watching the store, so changes made outside the app show up.
    func watchStore() {
        guard watcher == nil else { return }
        watcher = StoreWatcher(storePath: snapshot.storePath) { [weak self] in
            guard let self, !self.isMutating else { return }
            Task { await self.refresh(showSpinner: false) }
        }
    }

    private func load(showSpinner: Bool) async {
        if showSpinner { isRefreshing = true }
        defer { isRefreshing = false }
        do {
            let next = try await bridge.snapshot()
            guard !Task.isCancelled else { return }
            // A background refresh must not change the editor's baseline.
            if dirtyEditor, let current = selectedSkill {
                var skills = next.skills.filter { $0.id != current.id }
                skills.append(current)
                skills.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                snapshot = DesktopSnapshot(
                    generatedAt: next.generatedAt, storePath: next.storePath,
                    connections: next.connections, skills: skills, history: next.history
                )
            } else {
                snapshot = next
            }
            if !dirtyEditor, !isMutating, !visibleSkillIDs.contains(selectedSkillID ?? "") {
                selectedSkillID = visibleSkillIDs.first
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveSkill(_ skill: SkillRecord, name: String, description: String, body: String) async -> Bool {
        guard !isMutating else { return false }
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

    /// Asks before a delete. The sidebar menu and the toolbar share one alert.
    func requestDelete(_ skill: SkillRecord) {
        guard !isMutating else { return }
        pendingDelete = skill
    }

    func confirmDelete() async {
        guard let skill = pendingDelete else { return }
        pendingDelete = nil
        await deleteSkill(skill)
    }

    func setAlways(_ skill: SkillRecord, on: Bool) async {
        guard !isMutating, skill.always != on else { return }
        togglingAlwaysID = skill.id
        defer { togglingAlwaysID = nil }
        do {
            try await bridge.setAlways(name: skill.id, on: on)
            await refresh(showSpinner: false)
            showToast(on ? "\(skill.name) loads in every session" : "\(skill.name) loads on demand")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Adds a skill from a link or a folder and opens it.
    func addSkill(from source: String) async {
        guard !isMutating, !isDecomposing else { return }
        isAddingSource = true
        defer { isAddingSource = false }
        let before = Set(snapshot.skills.map(\.id))
        do {
            try await bridge.addSkill(source: source)
            await refresh(showSpinner: false)
            let added = snapshot.skills.map(\.id).filter { !before.contains($0) }
            clearBuilder()
            isBuilding = false
            if let first = added.first { selectedSkillID = first }
            showToast(added.count > 1 ? "Added \(added.count) skills" : "Added \(added.first ?? "skill")")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// File > Add Skill from Folder: picks a skill folder or a SKILL.md.
    func chooseFolderToAdd() {
        guard !isMutating else { return }
        let panel = NSOpenPanel()
        panel.message = "Choose a skill folder or a SKILL.md file."
        panel.prompt = "Add"
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await addSkill(from: url.path) }
    }

    func revealInFinder(_ skill: SkillRecord) {
        guard !skill.path.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting([skill.folderURL.appending(path: "SKILL.md")])
    }

    func copyName(_ skill: SkillRecord) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(skill.name, forType: .string)
        showToast("Copied \(skill.name)")
    }

    func deleteSkill(_ skill: SkillRecord) async {
        guard !isMutating else { return }
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
        guard !isMutating else { return }
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
        guard !idea.isEmpty, !isDecomposing, !isMutating else { return }
        isDecomposing = true
        builderProposals = []
        builderRationale = nil
        defer { isDecomposing = false }
        do {
            let response = try await bridge.decompose(idea: idea)
            guard !Task.isCancelled,
                  idea == builderIdea.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
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
        guard !installable.isEmpty, !isMutating, !isDecomposing else { return }
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
