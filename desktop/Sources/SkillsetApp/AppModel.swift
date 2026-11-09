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
    /// The skill whose category is being changed.
    var movingSkillID: String?
    var isAddingSource = false
    /// The skill waiting on the delete confirmation.
    var pendingDelete: SkillRecord?
    var busyConnectionID: String?
    /// The open editor holds changes that are not saved yet.
    var dirtyEditor = false
    var showDiscardAlert = false
    /// The New Skill page's draft: the same three fields the editor shows.
    var draftName = ""
    var draftDescription = ""
    var draftBody = ""
    /// A pasted SKILL.md asked to load in every session.
    var draftAlways = false
    /// The category and kind a pasted SKILL.md carried, kept for the new skill.
    var draftCategory: String?
    var draftKind: String?
    var isCreating = false
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
            || movingSkillID != nil || isAddingSource || isCreating || busyConnectionID != nil
    }

    var hasPendingWork: Bool { dirtyEditor || isMutating }


    var filteredSkills: [SkillRecord] {
        ranked(snapshot.skills, query: searchText) { skill in
            [skill.name, skill.description, skill.body]
        }
    }

    /// The sidebar's groups, in the order the user dragged them into.
    var skillGroups: [SkillGroup] {
        var buckets: [String: [SkillRecord]] = [:]
        for skill in filteredSkills {
            buckets[SkillGroup.name(for: skill), default: []].append(skill)
        }
        return orderedGroupNames.compactMap { name in
            buckets[name].map { SkillGroup(name: name, skills: $0) }
        }
    }

    /// Sidebar order, which search ranking and the groups both shape. A
    /// collapsed group still counts, so collapsing never moves the selection.
    var visibleSkillIDs: [String] { skillGroups.flatMap { $0.skills.map(\.id) } }

    /// Every category a skill uses, for the Category menu.
    var categoryNames: [String] {
        let used = Set(snapshot.skills.compactMap(\.category))
        return orderedGroupNames.filter(used.contains)
    }

    // MARK: sidebar groups

    /// Group names the user has put in order. Saved per Mac, like a window size.
    var groupOrder: [String] = UserDefaults.standard.stringArray(forKey: DefaultsKey.groupOrder) ?? [] {
        didSet { UserDefaults.standard.set(groupOrder, forKey: DefaultsKey.groupOrder) }
    }

    var collapsedGroups: Set<String> = Set(UserDefaults.standard.stringArray(forKey: DefaultsKey.collapsedGroups) ?? []) {
        didSet { UserDefaults.standard.set(collapsedGroups.sorted(), forKey: DefaultsKey.collapsedGroups) }
    }

    /// The group whose header is being dragged.
    var draggingGroup: String?
    /// The group the dragged one will land next to. The list does not change
    /// while the drag runs; only an insertion line moves. Changing rows under
    /// a running drag makes the list reload and jump.
    var dropTarget: String?
    /// Ends a drag that no header received: dropped outside, or cancelled.
    private var dragEndMonitor: Any?

    private enum DefaultsKey {
        static let groupOrder = "sidebarGroupOrder"
        static let collapsedGroups = "sidebarCollapsedGroups"
    }

    /// Every group name in the library, in sidebar order: the user's saved
    /// order first, then new groups in their default place.
    var orderedGroupNames: [String] {
        let names = Set(snapshot.skills.map(SkillGroup.name(for:)))
        let saved = Dictionary(groupOrder.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        return names.sorted { lhs, rhs in
            let left = saved[lhs] ?? SkillGroup.defaultRank(lhs, after: groupOrder.count)
            let right = saved[rhs] ?? SkillGroup.defaultRank(rhs, after: groupOrder.count)
            return left == right ? lhs.localizedStandardCompare(rhs) == .orderedAscending : left < right
        }
    }

    /// A search shows every match, so it opens collapsed groups.
    func isExpanded(_ group: String) -> Bool {
        !collapsedGroups.contains(group) || !searchText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func toggleGroup(_ group: String) {
        if collapsedGroups.contains(group) {
            collapsedGroups.remove(group)
        } else {
            collapsedGroups.insert(group)
        }
    }

    func beginGroupDrag(_ group: String) {
        draggingGroup = group
        dropTarget = nil
        guard dragEndMonitor == nil else { return }
        // AppKit keeps mouse events to itself while a drag runs. The first one
        // the app sees with no button down comes after the drag has ended.
        dragEndMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDown, .rightMouseDown, .scrollWheel, .keyDown]
        ) { [weak self] event in
            if NSEvent.pressedMouseButtons == 0 || event.type != .mouseMoved {
                MainActor.assumeIsolated { self?.endGroupDrag() }
            }
            return event
        }
    }

    func endGroupDrag() {
        draggingGroup = nil
        dropTarget = nil
        if let dragEndMonitor { NSEvent.removeMonitor(dragEndMonitor) }
        dragEndMonitor = nil
    }

    /// The pointer is over a group's header or one of its skills.
    func hoverGroup(_ target: String) {
        guard let draggingGroup else { return }
        let next = target == draggingGroup ? nil : target
        guard next != dropTarget else { return }
        withAnimation(.easeOut(duration: 0.12)) { dropTarget = next }
    }

    /// True when the dragged group lands after the target, so the insertion
    /// line goes under the target group instead of over it.
    var dropsBelowTarget: Bool {
        let order = orderedGroupNames
        guard let draggingGroup, let dropTarget,
              let from = order.firstIndex(of: draggingGroup),
              let to = order.firstIndex(of: dropTarget) else { return false }
        return from < to
    }

    /// Moves the dragged group to the marked place, once, after the drag ends.
    func dropGroup() {
        if let draggingGroup, let dropTarget {
            withAnimation(.smooth(duration: 0.3)) { moveGroup(draggingGroup, to: dropTarget) }
        }
        endGroupDrag()
    }

    /// Moves a dragged group to where another one sits. Dragged down, it lands
    /// after that group; dragged up, before it.
    func moveGroup(_ group: String, to target: String) {
        var order = orderedGroupNames
        guard group != target,
              let from = order.firstIndex(of: group),
              let to = order.firstIndex(of: target) else { return }
        order.remove(at: from)
        order.insert(group, at: to)
        groupOrder = order
    }

    /// The New Skill page holds text that is not saved yet.
    var hasDraft: Bool {
        !draftName.isEmpty
            || !draftDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !draftBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The draft box holds only a link or a folder, so Save adds the skill from there.
    var draftSource: String? {
        draftName.isEmpty && draftDescription.isEmpty ? SkillSource.detect(draftBody) : nil
    }

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
            try await bridge.setUpIfNeeded()
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

    /// Puts a skill in a sidebar group, or takes it out with nil.
    func setCategory(_ skill: SkillRecord, to category: String?) async {
        guard !isMutating, skill.category != category else { return }
        movingSkillID = skill.id
        defer { movingSkillID = nil }
        do {
            try await bridge.setCategory(name: skill.id, category: category)
            await refresh(showSpinner: false)
            showToast(category.map { "Moved \(skill.name) to \($0)" } ?? "\(skill.name) has no category")
        } catch {
            errorMessage = error.localizedDescription
        }
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
        guard !isMutating else { return }
        isAddingSource = true
        defer { isAddingSource = false }
        let before = Set(snapshot.skills.map(\.id))
        do {
            try await bridge.addSkill(source: source)
            await refresh(showSpinner: false)
            let added = snapshot.skills.map(\.id).filter { !before.contains($0) }
            if draftSource == source { clearDraft() }
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

    // MARK: new skill

    /// A SKILL.md pasted into the draft box fills the name and description
    /// from its frontmatter, and only the body stays in the box.
    func splitPastedSkill() async {
        let pasted = draftBody
        guard pasted.range(of: #"\A\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|\z)"#, options: .regularExpression) != nil
        else { return }
        guard let split = try? await bridge.splitSkill(markdown: pasted),
              draftBody == pasted,
              split.name != nil || split.description != nil else { return }
        if let name = split.name { draftName = SkillName.typing(name) }
        if let description = split.description { draftDescription = description }
        draftAlways = split.always ?? false
        draftCategory = split.category
        draftKind = split.kind
        draftBody = split.body
    }

    /// Saves the draft as a new skill and opens it.
    func createSkill() async {
        let name = SkillName.final(draftName)
        let description = draftDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard SkillName.isValid(name), !description.isEmpty, !isMutating else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            try await bridge.createSkill(
                name: name, description: description, body: draftBody,
                always: draftAlways, category: draftCategory, kind: draftKind
            )
            clearDraft()
            isBuilding = false
            selectedSkillID = name
            await refresh(showSpinner: false)
            showToast("Added \(name)")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearDraft() {
        draftName = ""
        draftDescription = ""
        draftBody = ""
        draftAlways = false
        draftCategory = nil
        draftKind = nil
    }
}

/// One sidebar section: a category, or one of the groups skillset adds.
struct SkillGroup: Identifiable, Equatable {
    let name: String
    let skills: [SkillRecord]

    var id: String { name }

    /// Skillify's group. It sits at the top.
    static let special = "Special"
    /// Rules that load in every session, whatever their category.
    static let alwaysOn = "Always On"
    /// Skills with no category yet. They sit at the bottom.
    static let onDemand = "On Demand"

    static func name(for skill: SkillRecord) -> String {
        if skill.category == special { return special }
        if skill.always { return alwaysOn }
        return skill.category ?? onDemand
    }

    /// Where a group goes before the user moves it: Special and Always On on
    /// top, categories next, skills with no category last.
    static func defaultRank(_ name: String, after savedCount: Int) -> Int {
        switch name {
        case special: -2
        case alwaysOn: -1
        case onDemand: Int.max
        default: savedCount
        }
    }
}
