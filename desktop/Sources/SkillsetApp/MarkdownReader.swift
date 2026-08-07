import SwiftUI

struct MarkdownReader: View {
    let markdown: String

    private var blocks: [MarkdownBlock] {
        MarkdownBlock.parse(markdown)
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(blocks) { block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block.kind {
        case .heading(let level):
            Text(inline(block.text))
                .font(headingFont(level))
                .padding(.top, level == 1 ? 4 : 8)
        case .paragraph:
            Text(inline(block.text))
                .font(.system(size: 15.5))
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
        case .bullet:
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Circle()
                    .fill(.secondary)
                    .frame(width: 4, height: 4)
                Text(inline(block.text))
                    .font(.system(size: 15.5))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, 8)
        case .numbered(let number):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(number).")
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 18, alignment: .trailing)
                Text(inline(block.text))
                    .font(.system(size: 15.5))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .quote:
            HStack(alignment: .top, spacing: 11) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.accentColor.opacity(0.6))
                    .frame(width: 3)
                Text(inline(block.text))
                    .font(.system(size: 15.5))
                    .foregroundStyle(.secondary)
                    .italic()
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 2)
        case .code:
            ScrollView(.horizontal) {
                Text(block.text)
                    .font(.system(size: 14, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(13)
            }
            .background(.quaternary.opacity(0.65), in: .rect(cornerRadius: 9))
        case .divider:
            Divider().padding(.vertical, 4)
        }
    }

    private func inline(_ source: String) -> AttributedString {
        (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(source)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.weight(.bold)
        case 2: .title2.weight(.semibold)
        case 3: .title3.weight(.semibold)
        default: .headline
        }
    }
}

private struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(Int)
        case paragraph
        case bullet
        case numbered(Int)
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

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                flushParagraph()
                result.append(MarkdownBlock(id: lineNumber, kind: .bullet, text: String(trimmed.dropFirst(2))))
                continue
            }

            if let numbered = numbered(from: trimmed) {
                flushParagraph()
                result.append(MarkdownBlock(id: lineNumber, kind: .numbered(numbered.number), text: numbered.text))
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
