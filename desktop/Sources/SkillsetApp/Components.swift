import AppKit
import SwiftUI

/// One spacing grid (multiples of 4) and one type scale for every screen.
enum UI {
    static let sidebarWidth: CGFloat = 280
    /// Reading column for a skill, centred in the detail pane.
    static let columnWidth: CGFloat = 680
    static let pageInset: CGFloat = 32
    /// Gap between the toolbar and the first line of a page.
    static let pageTop: CGFloat = 8
    /// Gap between the page header rule and the body below it.
    static let bodyTop: CGFloat = 20
    static let hairline = Color.primary.opacity(0.08)
    static let cardRadius: CGFloat = 12
    static let fieldRadius: CGFloat = 8
}

extension Font {
    /// The name of a skill, or the title of a page.
    static let pageTitle = Font.system(size: 26, weight: .bold)
    /// The line under a page title.
    static let pageSummary = Font.system(size: 13)
    /// Body text in the reading column.
    static let reading = Font.system(size: MarkdownMetrics.body)
}

/// Sizes the reader and the editor share, so text does not move between them.
enum MarkdownMetrics {
    static let body: CGFloat = 14
    static let mono: CGFloat = 12.5
    static let lineSpacing: CGFloat = 4

    static func heading(_ level: Int) -> (size: CGFloat, weight: NSFont.Weight) {
        switch level {
        case 1: (20, .bold)
        case 2: (17, .semibold)
        case 3: (15, .semibold)
        default: (body, .semibold)
        }
    }
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

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "Tool": "wrench.and.screwdriver"
        case "Workflow": "list.number"
        case "Judgement": "scalemass"
        case "Rule": "shield"
        default: "doc.text"
        }
    }
}

// MARK: - Toolbar

/// Pushes the items after it to the trailing edge. The window has no title, so
/// the toolbar has no flexible space of its own.
struct TrailingToolbarSpace: ToolbarContent {
    var body: some ToolbarContent {
        if #available(macOS 26.0, *) {
            ToolbarSpacer(.flexible, placement: .primaryAction)
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

/// Text buttons at the native control heights, with hover and press states.
struct PillButtonStyle: ButtonStyle {
    enum Size {
        case regular
        case small
    }

    var tone: ButtonTone = .neutral
    var size: Size = .regular

    func makeBody(configuration: Configuration) -> some View {
        PillButtonBody(configuration: configuration, tone: tone, size: size)
    }
}

private struct PillButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let tone: ButtonTone
    let size: PillButtonStyle.Size
    @State private var hovered = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.system(size: size == .regular ? 13 : 12, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, size == .regular ? 12 : 10)
            .frame(minHeight: size == .regular ? 28 : 24)
            .background(Capsule().fill(fill))
            .contentShape(.capsule)
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
        let pressed = configuration.isPressed
        switch tone {
        case .neutral: return .primary.opacity(pressed ? 0.16 : hovered ? 0.11 : 0.06)
        case .accent: return .accentColor.opacity(pressed ? 0.24 : hovered ? 0.18 : 0.11)
        case .destructive: return .red.opacity(pressed ? 0.2 : hovered ? 0.13 : 0)
        case .prominent: return .accentColor.opacity(pressed ? 0.74 : hovered ? 0.86 : 1)
        }
    }
}

/// Symbol-only buttons use a square hit area and a quiet highlight.
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
                Circle()
                    .fill(highlight.opacity(configuration.isPressed ? 0.18 : hovered && isEnabled ? 0.12 : 0))
            )
            .contentShape(.circle)
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
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: UI.fieldRadius, style: .continuous)
                    .fill(.primary.opacity(active ? 0.05 : 0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: UI.fieldRadius, style: .continuous)
                    .stroke(.primary.opacity(active ? 0.1 : 0))
            )
    }
}

/// An always-visible scroll bar narrows its scroll view. A view that sits above
/// the scroll view pads by the same width, so one column runs down the page.
struct ScrollBarGutter: ViewModifier {
    @State private var width = ScrollBarGutter.current

    func body(content: Content) -> some View {
        content
            .padding(.trailing, width)
            .onReceive(NotificationCenter.default.publisher(
                for: NSScroller.preferredScrollerStyleDidChangeNotification
            )) { _ in width = Self.current }
    }

    private static var current: CGFloat {
        NSScroller.preferredScrollerStyle == .legacy
            ? NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy)
            : 0
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
            .modifier(ToastSurface())
    }
}

/// Liquid Glass where the system has it, a material capsule before that.
private struct ToastSurface: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
                .background(.regularMaterial, in: .capsule)
                .overlay(Capsule().stroke(UI.hairline))
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        }
    }
}

struct EmptyState: View {
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(PillButtonStyle(tone: .prominent))
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: 320)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
