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
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Skill") { model.startBuilding() }
                    .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(before: .textEditing) {
                Button("Search Skills") { model.requestSearchFocus() }
                    .keyboardShortcut("f", modifiers: .command)
                Button("Edit Skill") { model.requestEdit() }
                    .keyboardShortcut("e", modifiers: .command)
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        if model.isMutating {
            let alert = NSAlert()
            alert.messageText = "Please wait for Skillset to finish."
            alert.informativeText = "A change is still being saved. Quit after it finishes."
            alert.addButton(withTitle: "OK")
            alert.runModal()
            return .terminateCancel
        }
        guard model.dirtyEditor else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Discard edits and quit?"
        alert.informativeText = "Your edits to this skill are not saved."
        alert.addButton(withTitle: "Keep Editing")
        alert.addButton(withTitle: "Discard and Quit")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }
}
