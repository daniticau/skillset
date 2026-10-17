import AppKit
import SwiftUI

/// The body editor. With `styled` on, Markdown takes its shape in place as you
/// type — headings grow, emphasis shows, code goes monospaced — while the
/// syntax stays visible and editable. Off, it is a plain monospaced editor.
///
/// Text starts at the page inset, in line with the fields above it. Heading
/// marks hang in the margin to the left of that line, so a heading starts
/// where its paragraph starts.
struct MarkdownTextView: NSViewRepresentable {
    @Binding var text: String
    var styled: Bool
    /// Takes the keyboard when it appears.
    var focusOnAppear = false

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
        textView.textContainerInset = NSSize(width: 0, height: UI.bodyTop)
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
        if focusOnAppear {
            DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        }
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
            // A fence can grow or end a code block anywhere below the edit.
            textView.needsDisplay = true
        }
    }
}

extension NSAttributedString.Key {
    /// Marks the lines of a fenced code block, which draw on one shared box.
    static let markdownCodeBlock = NSAttributedString.Key("SkillsetMarkdownCodeBlock")
}

/// Draws the code block boxes under the text, and keeps pasted text plain so
/// the styler stays the only source of attributes.
private final class ColumnTextView: NSTextView {
    override func draw(_ dirtyRect: NSRect) {
        drawCodeBlocks(in: dirtyRect)
        super.draw(dirtyRect)
    }

    /// One rounded box per block, as wide as the text column. A background
    /// colour on the characters would end each line at its last character.
    private func drawCodeBlocks(in dirtyRect: NSRect) {
        guard let storage = textStorage, let layoutManager, storage.length > 0 else { return }
        let fill = NSColor.textColor.withAlphaComponent(0.05)
        let all = NSRange(location: 0, length: storage.length)
        storage.enumerateAttribute(.markdownCodeBlock, in: all) { value, range, _ in
            guard value != nil else { return }
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            var box = NSRect.null
            layoutManager.enumerateLineFragments(forGlyphRange: glyphs) { rect, _, _, _, _ in
                box = box.union(rect)
            }
            guard !box.isNull else { return }
            box.origin.x = MarkdownStyler.margin
            box.origin.y += textContainerOrigin.y
            box.size.width = bounds.width - 2 * MarkdownStyler.margin
            guard box.intersects(dirtyRect) else { return }
            fill.setFill()
            NSBezierPath(roundedRect: box, xRadius: UI.fieldRadius, yRadius: UI.fieldRadius).fill()
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
    private static let bodySize = MarkdownMetrics.body
    private static let monoSize = MarkdownMetrics.mono
    /// Every line starts this far in. Heading marks use the space to its left.
    static let margin = UI.pageInset
    /// Code sits this far inside its box.
    private static let codePadding: CGFloat = 14

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

        var fences: [NSRange] = []
        // Paragraph ranges include the line break, so the box covers whole lines.
        text.enumerateSubstrings(in: full, options: [.byParagraphs, .substringNotRequired]) { _, range, enclosing, _ in
            let line = text.substring(with: range)
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                fences.append(range)
                if inCode {
                    let block = NSRange(location: codeStart, length: NSMaxRange(enclosing) - codeStart)
                    storage.addAttributes(codeBlockAttributes, range: block)
                    inCode = false
                } else {
                    inCode = true
                    codeStart = enclosing.location
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
        for fence in fences {
            dim(storage, fence)
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
            // The marks and their space hang left of the margin.
            let marks = String(repeating: "#", count: hashes) + " "
            let hang = (marks as NSString).size(withAttributes: [.font: font]).width
            storage.addAttributes([
                .font: font,
                .paragraphStyle: paragraph(
                    spacingBefore: hashes <= 2 ? 16 : 10,
                    spacing: 4,
                    firstLineIndent: max(0, margin - hang)
                ),
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
            storage.addAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, range: markerRange)
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
        let metrics = MarkdownMetrics.heading(level)
        return NSFont.systemFont(ofSize: metrics.size, weight: metrics.weight)
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
        let inset = margin + codePadding
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        style.firstLineHeadIndent = inset
        style.headIndent = inset
        style.tailIndent = -inset
        return [
            .font: monoFont(monoSize),
            .foregroundColor: NSColor.textColor,
            .paragraphStyle: style,
            .markdownCodeBlock: true,
        ]
    }

    /// `headIndent` and `firstLineIndent` count from the margin, except that a
    /// first line may start left of it to hang a heading's marks.
    private static func paragraph(
        spacingBefore: CGFloat,
        spacing: CGFloat,
        headIndent: CGFloat = 0,
        firstLineIndent: CGFloat? = nil
    ) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = MarkdownMetrics.lineSpacing
        style.paragraphSpacingBefore = spacingBefore
        style.paragraphSpacing = spacing
        style.firstLineHeadIndent = firstLineIndent ?? margin
        style.headIndent = margin + headIndent
        style.tailIndent = -margin
        return style
    }
}
