import SwiftUI

@main
struct SkillsetDesktopApp: App {
    var body: some Scene {
        Window("Skillset", id: "main") {
            RootView()
        }
        .defaultSize(width: 1_040, height: 700)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
