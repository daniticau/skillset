import AppKit
import SwiftUI

/// The body editor. With `styled` on, Markdown takes its shape in place as you
/// type — headings grow, emphasis shows, code goes monospaced — while the
/// syntax stays visible and editable. Off, it is a plain monospaced editor.
struct MarkdownTextView: NSViewRepresentable {
    @Binding var text: String
    var styled: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(
            size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        )
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layoutManager.addTextContainer(container)

        let textView = ColumnTextView(frame: .zero, textContainer: container)
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.importsGraphics = false
        textView.usesFontPanel = false
        textView.usesFindBar = false
        textView.textContainerInset = NSSize(width: UI.pageInset, height: 22)
        textView.delegate = context.coordinator
        textView.string = text

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder

        context.coordinator.textView = textView
        context.coordinator.styled = styled
        context.coordinator.restyle()
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        guard let textView = coordinator.textView else { return }
        var changed = false
        if textView.string != text {
            let selection = textView.selectedRange()
            textView.string = text
            let length = (text as NSString).length
            textView.setSelectedRange(NSRange(location: min(selection.location, length), length: 0))
            changed = true
        }
        if coordinator.styled != styled {
            coordinator.styled = styled
            changed = true
        }
        if changed { coordinator.restyle() }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownTextView
        weak var textView: NSTextView?
        var styled = true

        init(parent: MarkdownTextView) {
            self.parent = parent
        }

        /// Delegate callbacks arrive on the main thread; say so to the compiler.
        nonisolated func textDidChange(_ notification: Notification) {
            MainActor.assumeIsolated {
                guard let textView else { return }
                parent.text = textView.string
                restyle()
            }
        }

        func restyle() {
            guard let textView, let storage = textView.textStorage else { return }
            MarkdownStyler.apply(to: storage, styled: styled)
            textView.typingAttributes = MarkdownStyler.baseAttributes(styled: styled)
        }
    }
}

/// Keeps the text in the same centred column the reader uses, and keeps
/// pasted text plain so the styler stays the only source of attributes.
private final class ColumnTextView: NSTextView {
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let horizontal = max(UI.pageInset, (newSize.width - UI.columnWidth) / 2)
        let inset = NSSize(width: horizontal, height: 22)
        if textContainerInset != inset {
            textContainerInset = inset
        }
    }

    override func paste(_ sender: Any?) {
        pasteAsPlainText(sender)
    }

    /// Escape would otherwise open the completion list.
    override func complete(_ sender: Any?) { }
}

@MainActor
enum MarkdownStyler {
    private static let bodySize: CGFloat = 14
    private static let monoSize: CGFloat = 12.5

    static func baseAttributes(styled: Bool) -> [NSAttributedString.Key: Any] {
        [
            .font: styled ? NSFont.systemFont(ofSize: bodySize) : monoFont(monoSize),
            .foregroundColor: NSColor.textColor,
            .paragraphStyle: paragraph(spacingBefore: 0, spacing: 0),
        ]
    }

    static func apply(to storage: NSTextStorage, styled: Bool) {
        let full = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.setAttributes(baseAttributes(styled: styled), range: full)
        if styled { style(storage, in: full) }
        storage.endEditing()
    }

    // MARK: blocks

    private static func style(_ storage: NSTextStorage, in full: NSRange) {
        let string = storage.string
        let text = string as NSString
        var inCode = false
        var codeStart = 0
        var proseLines: [NSRange] = []

        text.enumerateSubstrings(in: full, options: [.byLines, .substringNotRequired]) { _, range, _, _ in
            let line = text.substring(with: range)
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if inCode {
                    let block = NSRange(location: codeStart, length: NSMaxRange(range) - codeStart)
                    storage.addAttributes(codeBlockAttributes, range: block)
                    inCode = false
                } else {
                    inCode = true
                    codeStart = range.location
                }
                return
            }
            if inCode { return }
            proseLines.append(range)
        }
        if inCode {
            let block = NSRange(location: codeStart, length: NSMaxRange(full) - codeStart)
            storage.addAttributes(codeBlockAttributes, range: block)
        }
        for range in proseLines {
            styleLine(storage, string: string, range: range)
        }
    }

    private static func styleLine(_ storage: NSTextStorage, string: String, range: NSRange) {
        let line = (string as NSString).substring(with: range)
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        let hashes = line.prefix { $0 == "#" }.count
        if (1...6).contains(hashes), line.dropFirst(hashes).first == " " {
            let font = headingFont(level: hashes)
            storage.addAttributes([
                .font: font,
                .paragraphStyle: paragraph(spacingBefore: hashes == 1 ? 8 : 12, spacing: 4),
            ], range: range)
            storage.addAttribute(
                .foregroundColor,
                value: NSColor.tertiaryLabelColor,
                range: NSRange(location: range.location, length: hashes + 1)
            )
            styleInline(storage, string: string, range: range, size: font.pointSize)
            return
        }

        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            storage.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor, range: range)
            return
        }

        if trimmed.hasPrefix(">") {
            storage.addAttributes([
                .foregroundColor: NSColor.secondaryLabelColor,
                .font: italic(NSFont.systemFont(ofSize: bodySize)),
            ], range: range)
            let indent = line.prefix { $0 == " " }.count
            storage.addAttribute(
                .foregroundColor,
                value: NSColor.tertiaryLabelColor,
                range: NSRange(location: range.location + indent, length: 1)
            )
            styleInline(storage, string: string, range: range, size: bodySize)
            return
        }

        if let marker = listMarker(line) {
            let markerRange = NSRange(location: range.location + marker.indent, length: marker.length)
            storage.addAttribute(.foregroundColor, value: NSColor.controlAccentColor, range: markerRange)
            let prefix = String(line.prefix(marker.indent + marker.length)) as NSString
            let width = prefix.size(withAttributes: [.font: NSFont.systemFont(ofSize: bodySize)]).width
            storage.addAttribute(
                .paragraphStyle,
                value: paragraph(spacingBefore: 0, spacing: 0, headIndent: width),
                range: range
            )
        }

        styleInline(storage, string: string, range: range, size: bodySize)
    }

    /// "- ", "* ", "+ ", "1. ", "12) " at the start of a line.
    private static func listMarker(_ line: String) -> (indent: Int, length: Int)? {
        let indent = line.prefix { $0 == " " || $0 == "\t" }.count
        let rest = line.dropFirst(indent)
        if rest.hasPrefix("- ") || rest.hasPrefix("* ") || rest.hasPrefix("+ ") {
            return (indent, 2)
        }
        let digits = rest.prefix { $0.isNumber }.count
        if (1...3).contains(digits) {
            let after = rest.dropFirst(digits)
            if after.hasPrefix(". ") || after.hasPrefix(") ") {
                return (indent, digits + 2)
            }
        }
        return nil
    }

    // MARK: inline

    private static let inlineCode = try! NSRegularExpression(pattern: "`[^`\\n]+`")
    private static let bold = try! NSRegularExpression(pattern: "(\\*\\*|__)(?=\\S)(.+?)(?<=\\S)\\1")
    private static let italicSpan = try! NSRegularExpression(
        pattern: "(?<![\\w*_])(\\*|_)(?=\\S)([^*_\\n]+?)(?<=\\S)\\1(?![\\w*_])"
    )
    private static let link = try! NSRegularExpression(pattern: "\\[([^\\]\\n]+)\\]\\(([^)\\n]+)\\)")

    private static func styleInline(_ storage: NSTextStorage, string: String, range: NSRange, size: CGFloat) {
        for match in bold.matches(in: string, range: range) {
            storage.addAttribute(.font, value: NSFont.systemFont(ofSize: size, weight: .bold), range: match.range(at: 2))
            dim(storage, NSRange(location: match.range.location, length: 2))
            dim(storage, NSRange(location: NSMaxRange(match.range) - 2, length: 2))
        }
        for match in italicSpan.matches(in: string, range: range) {
            let inner = match.range(at: 2)
            let current = storage.attribute(.font, at: inner.location, effectiveRange: nil) as? NSFont
                ?? NSFont.systemFont(ofSize: size)
            storage.addAttribute(.font, value: italic(current), range: inner)
            dim(storage, NSRange(location: match.range.location, length: 1))
            dim(storage, NSRange(location: NSMaxRange(match.range) - 1, length: 1))
        }
        for match in link.matches(in: string, range: range) {
            dim(storage, match.range)
            storage.addAttribute(.foregroundColor, value: NSColor.linkColor, range: match.range(at: 1))
        }
        for match in inlineCode.matches(in: string, range: range) {
            storage.addAttributes([
                .font: monoFont(max(size - 1.5, monoSize)),
                .backgroundColor: codeBackground,
            ], range: match.range)
        }
    }

    private static func dim(_ storage: NSTextStorage, _ range: NSRange) {
        storage.addAttribute(.foregroundColor, value: NSColor.tertiaryLabelColor, range: range)
    }

    // MARK: fonts

    private static func headingFont(level: Int) -> NSFont {
        switch level {
        case 1: NSFont.systemFont(ofSize: 22, weight: .bold)
        case 2: NSFont.systemFont(ofSize: 18, weight: .semibold)
        case 3: NSFont.systemFont(ofSize: 15.5, weight: .semibold)
        default: NSFont.systemFont(ofSize: bodySize, weight: .semibold)
        }
    }

    private static func monoFont(_ size: CGFloat) -> NSFont {
        NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }

    private static func italic(_ font: NSFont) -> NSFont {
        NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
    }

    private static var codeBackground: NSColor {
        NSColor.textColor.withAlphaComponent(0.055)
    }

    private static var codeBlockAttributes: [NSAttributedString.Key: Any] {
        [
            .font: monoFont(monoSize),
            .foregroundColor: NSColor.textColor,
            .backgroundColor: codeBackground,
            .paragraphStyle: paragraph(spacingBefore: 0, spacing: 0),
        ]
    }

    private static func paragraph(
        spacingBefore: CGFloat,
        spacing: CGFloat,
        headIndent: CGFloat = 0
    ) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        style.paragraphSpacingBefore = spacingBefore
        style.paragraphSpacing = spacing
        style.headIndent = headIndent
        return style
    }
}
