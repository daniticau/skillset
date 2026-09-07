import AppKit
import SwiftUI

/// One window, two columns: the library on the left, one thing on the right —
/// the selected skill, or the builder when you are making a new one.
struct RootView: View {
    @Bindable var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            Sidebar(model: model)
                .frame(width: UI.sidebarWidth)

            Hairline(axis: .vertical)

            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .textBackgroundColor))
        }
        // `.hiddenTitleBar` still reserves the title-bar band as a safe area.
        // Claim it so the sidebar runs to the top edge, under the traffic lights.
        .ignoresSafeArea(.container, edges: .top)
        .background(WindowConfigurator())
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
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                await model.refresh(showSpinner: false)
            }
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
            BuilderView(model: model)
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
    func makeCoordinator() -> Coordinator { Coordinator() }

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
        window.level = .normal
        window.collectionBehavior.remove(.fullScreenAuxiliary)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.styleMask.insert([.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView])
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.isMovableByWindowBackground = false
        guard !coordinator.positioned, let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = NSSize(width: 1_040, height: 700)
        window.setFrame(
            NSRect(
                x: visible.midX - size.width / 2,
                y: visible.maxY - size.height - 60,
                width: size.width,
                height: size.height
            ),
            display: true
        )
        coordinator.positioned = true
    }

    final class Coordinator {
        var positioned = false
    }
}
