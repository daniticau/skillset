import AppKit
import SwiftUI

/// One window, two columns: the library on the left, one thing on the right —
/// the selected skill, or the builder when you are making a new one. The split
/// view, the sidebar surface, and the toolbar all come from the system.
struct RootView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationSplitView {
            Sidebar(model: model)
                .navigationSplitViewColumnWidth(min: 260, ideal: UI.sidebarWidth, max: 400)
        } detail: {
            detail
                // An empty title keeps the toolbar's title area. It fills the
                // space left of the actions, so they sit on the trailing edge
                // without a spacer item that lights up on hover.
                .navigationTitle("")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .textBackgroundColor))
        }
        .background(WindowConfigurator(model: model))
        .background(DebugSnapshot(model: model))
        .frame(minWidth: 840, minHeight: 540)
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                ToastView(toast: toast)
                    .padding(.bottom, 18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task {
            await model.refresh()
            model.watchStore()
        }
        // A changed store also shows on return to the app, if a watch event
        // was missed while it sat in the background.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            guard !model.isMutating, !model.snapshot.generatedAt.isEmpty else { return }
            Task { await model.refresh(showSpinner: false) }
        }
        .alert(
            "Delete \(model.pendingDelete?.name ?? "skill")?",
            isPresented: Binding(
                get: { model.pendingDelete != nil },
                set: { if !$0 { model.pendingDelete = nil } }
            )
        ) {
            Button("Delete", role: .destructive) { Task { await model.confirmDelete() } }
            Button("Cancel", role: .cancel) { model.pendingDelete = nil }
        } message: {
            Text("Removes it from the library and from every connected agent. The store's history keeps a copy.")
        }
        .alert("Discard changes?", isPresented: $model.showDiscardAlert) {
            Button("Discard", role: .destructive) { model.discardAndContinue() }
            Button("Keep Editing", role: .cancel) { model.keepEditing() }
        } message: {
            Text("Your edits to this skill are not saved.")
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.errorMessage = nil } }
            )
        ) {
            Button("OK") { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Unknown error")
        }
    }

    @ViewBuilder
    private var detail: some View {
        if model.isBuilding {
            NewSkillView(model: model)
        } else if let skill = model.selectedSkill {
            SkillDetail(model: model, skill: skill)
                .id(skill.id)
        } else if model.snapshot.skills.isEmpty {
            EmptyState(
                title: model.isRefreshing ? "Loading" : "No skills yet",
                message: model.isRefreshing
                    ? "Reading the library."
                    : "Write down something your agents cannot work out on their own.",
                actionTitle: model.isRefreshing ? nil : "New skill",
                action: { model.startBuilding() }
            )
        } else {
            EmptyState(title: "No matches", message: "No skill matches that search.")
        }
    }
}

private struct WindowConfigurator: NSViewRepresentable {
    let model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { configure(view.window, coordinator: context.coordinator) }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async { configure(view.window, coordinator: context.coordinator) }
    }

    private func configure(_ window: NSWindow?, coordinator: Coordinator) {
        guard let window else { return }
        window.delegate = coordinator
        window.level = .normal
        window.collectionBehavior.remove(.fullScreenAuxiliary)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.titlebarSeparatorStyle = .none
        guard !coordinator.positioned, let screen = window.screen ?? NSScreen.main else { return }
        window.setFrame(TitleBarDoubleClick.startFrame(in: screen.visibleFrame), display: true)
        coordinator.doubleClick = TitleBarDoubleClick(window: window)
        coordinator.positioned = true
    }

    final class Coordinator: NSObject, NSWindowDelegate {
        let model: AppModel
        var positioned = false
        var doubleClick: TitleBarDoubleClick?

        init(model: AppModel) { self.model = model }

        func windowShouldClose(_ sender: NSWindow) -> Bool {
            MainActor.assumeIsolated { CloseGuard.allowsClose(model, action: "Discard") }
        }
    }
}

/// A double-click on the empty title bar fills the screen, and a second one
/// should put the window back. macOS fills this window but does not restore
/// it, so the app keeps the frame from before the fill and restores it itself.
/// Double-clicks on toolbar buttons and the traffic lights pass through.
@MainActor
final class TitleBarDoubleClick {
    private weak var window: NSWindow?
    private var monitor: Any?
    private var frameBeforeFill: NSRect?

    init(window: NSWindow) {
        self.window = window
        // AppKit calls local monitors on the main thread.
        monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.handle(event) ?? event
        }
    }

    /// Where the window opens, and where it goes back to when no earlier frame is known.
    static func startFrame(in visible: NSRect) -> NSRect {
        let size = NSSize(width: 1_040, height: 700)
        return NSRect(
            x: visible.midX - size.width / 2,
            y: visible.maxY - size.height - 60,
            width: size.width,
            height: size.height
        )
    }

    private func handle(_ event: NSEvent) -> NSEvent? {
        guard event.clickCount == 2, let window, event.window === window,
              Self.fillsOnDoubleClick,
              event.locationInWindow.y >= window.contentLayoutRect.maxY,
              !Self.hitsControl(at: event.locationInWindow, in: window),
              let visible = window.screen?.visibleFrame else { return event }
        guard Self.covers(window.frame, visible) else {
            // macOS fills the window. Remember where it was.
            frameBeforeFill = window.frame
            return event
        }
        let restored = frameBeforeFill ?? Self.startFrame(in: visible)
        frameBeforeFill = nil
        window.setFrame(restored, display: true, animate: true)
        return nil
    }

    /// The title bar setting in Desktop & Dock. Minimize and Do Nothing stay with macOS.
    private static var fillsOnDoubleClick: Bool {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case nil, "Fill", "Maximize": true
        default: false
        }
    }

    /// Filled, give or take the margins macOS may leave around a tiled window.
    private static func covers(_ frame: NSRect, _ visible: NSRect) -> Bool {
        frame.width >= visible.width - 32 && frame.height >= visible.height - 32
    }

    private static func hitsControl(at point: NSPoint, in window: NSWindow) -> Bool {
        guard let frameView = window.contentView?.superview else { return true }
        var view = frameView.hitTest(point)
        while let current = view, current !== frameView {
            if let field = current as? NSTextField {
                if field.isEditable { return true }
            } else if current is NSControl {
                return true
            }
            let name = String(describing: type(of: current))
            if name.hasPrefix("ToolbarItemHostingView") || name.contains("ThemeWidget") { return true }
            view = current.superview
        }
        return false
    }
}
