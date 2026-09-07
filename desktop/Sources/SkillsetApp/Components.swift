import AppKit
import SwiftUI

enum UI {
    static let sidebarWidth: CGFloat = 272
    /// Clears the traffic lights. The band above it drags the window.
    static let topInset: CGFloat = 44
    /// Reading column for a skill, centred in the detail pane.
    static let columnWidth: CGFloat = 720
    static let pageInset: CGFloat = 32
    static let hairline = Color.primary.opacity(0.08)
}

struct Hairline: View {
    var axis: Axis = .horizontal

    var body: some View {
        Rectangle()
            .fill(UI.hairline)
            .frame(
                width: axis == .vertical ? 1 : nil,
                height: axis == .horizontal ? 1 : nil
            )
    }
}

enum SkillKindStyle {
    static func color(_ kind: String) -> Color {
        switch kind {
        case "Tool": .blue
        case "Workflow": .purple
        case "Judgement": .orange
        case "Rule": .pink
        default: .gray
        }
    }
}

// MARK: - Window chrome

/// Drag moves the window. A double-click follows the System Settings choice
/// for a window's title bar (zoom, minimise, or nothing). Full screen stays on
/// the green button, so a double-click can never trap the window there.
@MainActor
private func handleTitleBarClick(_ event: NSEvent, in view: NSView) {
    guard let window = view.window else { return }
    if event.clickCount == 2 {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window.miniaturize(nil)
        case "None": break
        default: window.zoom(nil)
        }
    } else {
        window.performDrag(with: event)
    }
}

/// The title-bar band over the detail pane.
struct WindowDragArea: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { DragView() }

    func updateNSView(_ nsView: NSView, context: Context) { }

    private final class DragView: NSView {
        override func mouseDown(with event: NSEvent) {
            handleTitleBarClick(event, in: self)
        }
    }
}

/// Sidebar vibrancy. Empty parts of the sidebar also drag the window; the top
/// band behaves like a title bar.
struct SidebarMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = DraggableEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .followsWindowActiveState
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) { }

    private final class DraggableEffectView: NSVisualEffectView {
        override func mouseDown(with event: NSEvent) {
            let point = convert(event.locationInWindow, from: nil)
            if bounds.maxY - point.y <= UI.topInset {
                handleTitleBarClick(event, in: self)
            } else {
                window?.performDrag(with: event)
            }
        }
    }
}

// MARK: - Buttons

enum ButtonTone {
    case neutral
    case accent
    case destructive
    case prominent
}

/// Text buttons: a capsule that lifts on hover and settles on press.
struct PillButtonStyle: ButtonStyle {
    var tone: ButtonTone = .neutral

    func makeBody(configuration: Configuration) -> some View {
        PillButtonBody(configuration: configuration, tone: tone)
    }
}

private struct PillButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let tone: ButtonTone
    @State private var hovered = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(Capsule().fill(fill))
            .contentShape(.capsule)
            .scaleEffect(configuration.isPressed ? 0.96 : hovered && isEnabled ? 1.03 : 1)
            .onHover { hovered = $0 }
            .animation(.snappy(duration: 0.16), value: hovered)
            .animation(.snappy(duration: 0.1), value: configuration.isPressed)
    }

    /// A disabled button goes quiet and grey rather than faint, so "Save" still
    /// reads on a light background.
    private var foreground: Color {
        guard isEnabled else { return .secondary.opacity(0.6) }
        switch tone {
        case .neutral: return .primary
        case .accent: return .accentColor
        case .destructive: return .red
        case .prominent: return .white
        }
    }

    private var fill: Color {
        guard isEnabled else { return .primary.opacity(0.05) }
        switch tone {
        case .neutral: return .primary.opacity(hovered ? 0.11 : 0.06)
        case .accent: return .accentColor.opacity(hovered ? 0.18 : 0.11)
        case .destructive: return .red.opacity(hovered ? 0.13 : 0)
        case .prominent: return .accentColor.opacity(hovered ? 0.86 : 1)
        }
    }
}

/// Symbol-only buttons: a square hit area, a soft highlight and a small lift on hover.
struct IconButtonStyle: ButtonStyle {
    var tone: ButtonTone = .neutral
    var size: CGFloat = 28

    func makeBody(configuration: Configuration) -> some View {
        IconButtonBody(configuration: configuration, tone: tone, size: size)
    }
}

private struct IconButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let tone: ButtonTone
    let size: CGFloat
    @State private var hovered = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(highlight.opacity(hovered ? 0.12 : 0))
            )
            .contentShape(.rect)
            .scaleEffect(configuration.isPressed ? 0.9 : hovered ? 1.08 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovered = $0 }
            .animation(.snappy(duration: 0.16), value: hovered)
            .animation(.snappy(duration: 0.1), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch tone {
        case .destructive: .red
        case .accent, .prominent: .accentColor
        case .neutral: hovered ? .primary : .secondary
        }
    }

    private var highlight: Color {
        switch tone {
        case .destructive: .red
        case .accent, .prominent: .accentColor
        case .neutral: .primary
        }
    }
}

// MARK: - Fields

/// Shared padding for the title and description in both modes, so the text
/// does not move when editing starts. Only the edit state paints a field.
struct FieldChrome: ViewModifier {
    var active: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(.primary.opacity(active ? 0.05 : 0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(.primary.opacity(active ? 0.1 : 0))
            )
    }
}

// MARK: - Feedback

struct ToastView: View {
    let toast: AppToast

    var body: some View {
        Text(toast.message)
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: .capsule)
            .overlay(Capsule().stroke(UI.hairline))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
    }
}

struct EmptyState: View {
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
            Text(message)
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(PillButtonStyle(tone: .prominent))
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: 320)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
