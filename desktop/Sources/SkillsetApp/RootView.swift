import AppKit
import SwiftUI

struct RootView: View {
    @State private var model = AppModel()

    var body: some View {
        VStack(spacing: 0) {
            TopBar(model: model)

            Group {
                switch model.section {
                case .library:
                    LibraryView(model: model)
                case .builder:
                    BuilderView(model: model)
                case .settings:
                    SettingsView(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(.background)
        .overlay(alignment: .top) {
            if let toast = model.toast {
                ToastView(toast: toast)
                    .padding(.top, 54)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .background(WindowConfigurator())
        .frame(minWidth: 820, minHeight: 560)
        .task {
            await model.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                await model.refresh(showSpinner: false)
            }
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
}

/// The only chrome: a centered two-way switch under the window edge.
///
/// Left of it sits the traffic-light inset, right of it the settings affordance,
/// so the switch reads as the true center of the app rather than a toolbar item.
private struct TopBar: View {
    @Bindable var model: AppModel

    private var liveCount: Int {
        model.snapshot.connections.filter { $0.configured && $0.status == .live }.count
    }

    var body: some View {
        // Height matches the standard macOS titlebar so everything here centers
        // on the same axis as the traffic lights. The switch is centered on the
        // full window width — not on the space left over after the traffic
        // lights — so it reads as the true middle of the window.
        ZStack {
            SegmentedSwitch(
                selection: Binding(
                    get: { model.section == .settings ? .library : model.section },
                    set: { model.section = $0 }
                )
            )

            HStack(spacing: 0) {
                Spacer()

                Button {
                    model.section = model.section == .settings ? .library : .settings
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 12))
                        .foregroundStyle(model.section == .settings ? .primary : .secondary)
                        .frame(width: 22, height: 22)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help("\(liveCount) agent\(liveCount == 1 ? "" : "s") connected")
            }
            .padding(.trailing, 12)
        }
        .frame(height: 28)
        .background(WindowDragArea())
    }
}

private struct SegmentedSwitch: View {
    @Binding var selection: SidebarSection
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 2) {
            ForEach(SidebarSection.primary) { section in
                let active = selection == section
                Button {
                    withAnimation(.snappy(duration: 0.22, extraBounce: 0.05)) {
                        selection = section
                    }
                } label: {
                    // Sized so the whole control fits inside the 28pt titlebar
                    // band without pushing the content below it down.
                    Text(section.title)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(active ? .primary : .secondary)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 3)
                        .contentShape(.rect)
                        .background {
                            if active {
                                Capsule()
                                    .fill(.background)
                                    .shadow(color: .black.opacity(0.16), radius: 2, y: 1)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(section.title)
            }
        }
        .padding(2)
        .background(Capsule().fill(.primary.opacity(0.07)))
    }
}

private struct ToastView: View {
    let toast: AppToast

    var body: some View {
        Text(toast.message)
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: .capsule)
            .shadow(color: .black.opacity(0.14), radius: 12, y: 4)
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
        window.isMovableByWindowBackground = false
        window.standardWindowButton(.zoomButton)?.isEnabled = true
        guard !coordinator.positioned, let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = NSSize(width: 1_000, height: 680)
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
