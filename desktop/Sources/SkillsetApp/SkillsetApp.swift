import SwiftUI

@main
struct SkillsetDesktopApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        Window("Skillset", id: "main") {
            RootView(model: model)
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
