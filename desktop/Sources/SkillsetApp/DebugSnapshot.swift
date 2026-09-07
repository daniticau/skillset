import AppKit
import SwiftUI

/// Renders the window to a PNG without screen-recording permission, so the UI
/// can be checked from a script:
///
///     SKILLSET_SNAPSHOT_PATH=/tmp/app.png \
///     [SKILLSET_SNAPSHOT_STATE=edit|builder|settings] \
///     [SKILLSET_SNAPSHOT_APPEARANCE=light|dark] \
///     [SKILLSET_SNAPSHOT_QUIT=1] Skillset.app/Contents/MacOS/Skillset
///
/// Does nothing unless the path is set.
struct DebugSnapshot: View {
    let model: AppModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        SnapshotHook(model: model, openSettings: { openSettings() })
    }
}

private struct SnapshotHook: NSViewRepresentable {
    let model: AppModel
    let openSettings: () -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["SKILLSET_SNAPSHOT_PATH"] else { return view }
        let state = environment["SKILLSET_SNAPSHOT_STATE"] ?? ""
        let delay = Double(environment["SKILLSET_SNAPSHOT_DELAY"] ?? "") ?? 3
        switch environment["SKILLSET_SNAPSHOT_APPEARANCE"] {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: break
        }
        let model = model
        let openSettings = openSettings
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            switch state {
            case "edit": model.requestEdit()
            case "edit-type":
                // Type through the normal input path so the styler and the
                // binding run exactly as they do for a person.
                model.requestEdit()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    guard let textView = Self.firstTextView(in: view.window?.contentView) else { return }
                    view.window?.makeFirstResponder(textView)
                    textView.setSelectedRange(NSRange(location: 0, length: 0))
                    textView.insertText(
                        "## Typed heading\n\nSome **bold**, some _italic_, a [link](https://example.com) and `code`.\n\n",
                        replacementRange: NSRange(location: 0, length: 0)
                    )
                }
            case "builder": model.startBuilding()
            case "settings": openSettings()
            default: break
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                let window = state == "settings"
                    ? NSApp.windows.first { $0.isVisible && $0 !== view.window }
                    : view.window
                Self.write(window?.contentView, to: path)
                if environment["SKILLSET_SNAPSHOT_QUIT"] == "1" { NSApp.terminate(nil) }
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) { }

    private static func firstTextView(in view: NSView?) -> NSTextView? {
        guard let view else { return nil }
        if let textView = view as? NSTextView { return textView }
        for child in view.subviews {
            if let found = firstTextView(in: child) { return found }
        }
        return nil
    }

    private static func write(_ view: NSView?, to path: String) {
        guard let view,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let data = rep.representation(using: NSBitmapImageRep.FileType.png, properties: [:]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }
}
