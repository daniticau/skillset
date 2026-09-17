import AppKit
import SwiftUI

struct MarkdownReader: View {
    let markdown: String

    var body: some View {
        let blocks = MarkdownBlock.parse(markdown)
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                blockView(block)
                    .padding(.top, index == 0 ? 0 : gap(above: block, below: blocks[index - 1]))
            }
        }
        .textSelection(.enabled)
    }

    /// Space above a block. List items sit close together, a heading opens a
    /// section, and the text under a heading stays near it.
    private func gap(above block: MarkdownBlock, below previous: MarkdownBlock) -> CGFloat {
        switch (previous.kind, block.kind) {
        case (_, .heading(let level)): level <= 2 ? 28 : 20
        case (.heading, _): 8
        case (.bullet, .bullet), (.numbered, .numbered), (.bullet, .numbered), (.numbered, .bullet): 6
        case (.quote, .quote): 0
        default: 12
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block.kind {
        case .heading(let level):
            let metrics = MarkdownMetrics.heading(level)
            Text(inline(block.text, size: metrics.size))
                .font(.system(size: metrics.size, weight: Font.Weight(metrics.weight)))
                .fixedSize(horizontal: false, vertical: true)
        case .paragraph:
            prose(block.text)
        case .bullet(let indent):
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("•")
                    .font(.reading)
                    .foregroundStyle(.secondary)
                    .frame(width: 18, alignment: .leading)
                prose(block.text)
            }
            .padding(.leading, 2 + CGFloat(indent) * 18)
        case .numbered(let number, let indent):
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("\(number).")
                    .font(.reading)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .frame(minWidth: 22, alignment: .leading)
                prose(block.text)
            }
            .padding(.leading, 2 + CGFloat(indent) * 18)
        case .quote:
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(.tertiary)
                    .frame(width: 3)
                prose(block.text)
                    .foregroundStyle(.secondary)
            }
        case .code:
            ScrollView(.horizontal) {
                Text(block.text)
                    .font(.system(size: MarkdownMetrics.mono, design: .monospaced))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.primary.opacity(0.045), in: .rect(cornerRadius: UI.fieldRadius, style: .continuous))
        case .divider:
            Hairline().padding(.vertical, 8)
        }
    }

    private func prose(_ source: String) -> some View {
        Text(inline(source, size: MarkdownMetrics.body))
            .font(.reading)
            .lineSpacing(MarkdownMetrics.lineSpacing)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Inline Markdown. Code spans get the editor's look: a smaller monospaced
    /// face on a faint fill.
    private func inline(_ source: String, size: CGFloat) -> AttributedString {
        var text = (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(source)
        for run in text.runs where run.inlinePresentationIntent?.contains(.code) == true {
            text[run.range].font = .system(size: max(size - 1.5, MarkdownMetrics.mono), design: .monospaced)
            text[run.range].backgroundColor = .primary.opacity(0.06)
        }
        return text
    }
}

private extension Font.Weight {
    init(_ weight: NSFont.Weight) {
        self = weight == .bold ? .bold : .semibold
    }
}

private struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(Int)
        case paragraph
        case bullet(indent: Int)
        case numbered(Int, indent: Int)
        case quote
        case code
        case divider
    }

    let id: Int
    let kind: Kind
    let text: String

    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.components(separatedBy: .newlines)
        var result: [MarkdownBlock] = []
        var paragraph: [String] = []
        var paragraphStart = 0
        var code: [String] = []
        var codeStart = 0
        var inCode = false

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            result.append(MarkdownBlock(
                id: paragraphStart,
                kind: .paragraph,
                text: paragraph.joined(separator: " ")
            ))
            paragraph.removeAll()
        }

        for (lineNumber, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                if inCode {
                    result.append(MarkdownBlock(id: codeStart, kind: .code, text: code.joined(separator: "\n")))
                    code.removeAll()
                } else {
                    flushParagraph()
                    codeStart = lineNumber
                }
                inCode.toggle()
                continue
            }

            if inCode {
                code.append(line)
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if trimmed == "---" || trimmed == "***" {
                flushParagraph()
                result.append(MarkdownBlock(id: lineNumber, kind: .divider, text: ""))
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                result.append(MarkdownBlock(id: lineNumber, kind: .heading(heading.level), text: heading.text))
                continue
            }

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                flushParagraph()
                result.append(MarkdownBlock(
                    id: lineNumber,
                    kind: .bullet(indent: indent(of: line)),
                    text: String(trimmed.dropFirst(2))
                ))
                continue
            }

            if let numbered = numbered(from: trimmed) {
                flushParagraph()
                result.append(MarkdownBlock(
                    id: lineNumber,
                    kind: .numbered(numbered.number, indent: indent(of: line)),
                    text: numbered.text
                ))
                continue
            }

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                result.append(MarkdownBlock(id: lineNumber, kind: .quote, text: String(trimmed.dropFirst(2))))
                continue
            }

            if paragraph.isEmpty { paragraphStart = lineNumber }
            paragraph.append(trimmed)
        }

        flushParagraph()
        if inCode, !code.isEmpty {
            result.append(MarkdownBlock(id: codeStart, kind: .code, text: code.joined(separator: "\n")))
        }
        return result
    }

    /// Nesting depth of a list item: two spaces, or one tab, per level.
    private static func indent(of line: String) -> Int {
        var columns = 0
        for character in line {
            if character == " " { columns += 1 }
            else if character == "\t" { columns += 2 }
            else { break }
        }
        return min(columns / 2, 4)
    }

    private static func heading(from line: String) -> (level: Int, text: String)? {
        let count = line.prefix { $0 == "#" }.count
        guard (1...6).contains(count), line.dropFirst(count).first == " " else { return nil }
        return (count, String(line.dropFirst(count + 1)))
    }

    private static func numbered(from line: String) -> (number: Int, text: String)? {
        guard let dot = line.firstIndex(of: "."),
              let number = Int(line[..<dot]),
              line.index(after: dot) < line.endIndex,
              line[line.index(after: dot)] == " " else { return nil }
        return (number, String(line[line.index(dot, offsetBy: 2)...]))
    }
}
