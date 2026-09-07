import Foundation

/// A skill's name is its folder name and the id agents load it by, so it must
/// be kebab-case. The title field normalises as you type instead of rejecting
/// what you typed.
enum SkillName {
    static let maxLength = 80

    /// Live normalisation. A trailing hyphen is kept so typing can continue.
    static func typing(_ raw: String) -> String {
        var out = ""
        var lastWasHyphen = false
        for character in raw.lowercased() {
            if character.isASCII, character.isLetter || character.isNumber {
                out.append(character)
                lastWasHyphen = false
            } else if !lastWasHyphen, !out.isEmpty {
                out.append("-")
                lastWasHyphen = true
            }
        }
        return String(out.prefix(maxLength))
    }

    /// The name that is saved.
    static func final(_ raw: String) -> String {
        var name = typing(raw)
        while name.hasSuffix("-") { name.removeLast() }
        return name
    }

    static func isValid(_ name: String) -> Bool {
        !name.isEmpty && name == final(name)
    }
}
