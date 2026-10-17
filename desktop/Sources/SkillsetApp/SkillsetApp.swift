import AppKit
import SwiftUI

@main
struct SkillsetDesktopApp: App {
    @State private var model = AppModel()
    @NSApplicationDelegateAdaptor(SkillsetAppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Skillset", id: "main") {
            RootView(model: model)
                .onAppear { appDelegate.model = model }
        }
        .defaultSize(width: 1_040, height: 700)
        .windowResizability(.contentMinSize)
        // A real toolbar puts the traffic lights at their native inset and
        // gives the sidebar its system (Liquid Glass) surface.
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Skill") { model.startBuilding() }
                    .keyboardShortcut("n", modifiers: .command)
                Button("Add Skill from Folder…") { model.chooseFolderToAdd() }
                    .keyboardShortcut("o", modifiers: .command)
            }
            CommandGroup(before: .textEditing) {
                Button("Search Skills") { model.requestSearchFocus() }
                    .keyboardShortcut("f", modifiers: .command)
            }
            CommandMenu("Skill") {
                SkillCommands(model: model)
            }
        }

        Settings {
            SettingsView(model: model)
        }
    }
}

@MainActor
final class SkillsetAppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?

    /// A background launch (a script, `open -g`) gets no main window until the
    /// app receives a reopen event. The snapshot hook lives in that window, so
    /// a snapshot run asks for one. It does not take focus.
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard ProcessInfo.processInfo.environment["SKILLSET_SNAPSHOT_PATH"] != nil,
              Bundle.main.bundleURL.pathExtension == "app" else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.open(Bundle.main.bundleURL, configuration: configuration)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        return CloseGuard.allowsClose(model, action: "Discard and Quit") ? .terminateNow : .terminateCancel
    }
}

/// The Skill menu acts on the open skill, with the same items as the
/// sidebar's context menu.
private struct SkillCommands: View {
    @Bindable var model: AppModel

    private var skill: SkillRecord? { model.isBuilding ? nil : model.selectedSkill }

    var body: some View {
        Button("Edit") { model.requestEdit() }
            .keyboardShortcut("e", modifiers: .command)
            .disabled(skill == nil || model.isMutating)
        Button(skill?.always == true ? "Load on Demand" : "Load in Every Session") {
            guard let skill else { return }
            Task { await model.setAlways(skill, on: !skill.always) }
        }
        .keyboardShortcut("l", modifiers: [.command, .shift])
        .disabled(skill == nil || model.isMutating)
        Divider()
        Button("Show in Finder") { skill.map(model.revealInFinder) }
            .keyboardShortcut("r", modifiers: [.command, .shift])
            .disabled(skill?.path.isEmpty ?? true)
        Button("Copy Name") { skill.map(model.copyName) }
            .disabled(skill == nil)
        Divider()
        Button("Delete…") { skill.map(model.requestDelete) }
            .keyboardShortcut(.delete, modifiers: .command)
            .disabled(skill == nil || model.isMutating)
    }
}

/// Asks before a window closes or the app quits with work in flight. A save
/// that is still running blocks the close. Unsaved edits ask first.
@MainActor
enum CloseGuard {
    static func allowsClose(_ model: AppModel, action: String) -> Bool {
        if model.isMutating {
            let alert = NSAlert()
            alert.messageText = "Wait for this change to finish"
            alert.informativeText = "Skillset is still updating your library."
            alert.addButton(withTitle: "OK")
            alert.runModal()
            return false
        }
        guard model.dirtyEditor else { return true }
        let alert = NSAlert()
        alert.messageText = "Discard your edits?"
        alert.informativeText = "Your edits to this skill are not saved."
        alert.addButton(withTitle: "Keep Editing")
        alert.addButton(withTitle: action)
        return alert.runModal() == .alertSecondButtonReturn
    }
}
