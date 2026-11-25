import Foundation

/// Titre lisible de la note d'une carte, port de shared/source-title.ts (mêmes règles, mêmes cas de test).
public enum SourceTitle {
    /// 1 à 200 points de code (`cards_source_title_check` de la PWA).
    public static let maxLength = 200

    /// Espaces au sens de `\s` et de `trim()` en JavaScript.
    static func isSpace(_ u: Unicode.Scalar) -> Bool { Tags.isSpace(u) }

    static func trim(_ s: Substring) -> Substring {
        var scalars = s.unicodeScalars[...]
        while let f = scalars.first, isSpace(f) { scalars = scalars.dropFirst() }
        while let l = scalars.last, isSpace(l) { scalars = scalars.dropLast() }
        return Substring(scalars)
    }

    static func trim(_ s: String) -> String { String(trim(s[...])) }

    /// Plafonne à `maxLength` points de code ; `…` si coupé.
    static func capLength(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        guard scalars.count > maxLength else { return text }
        var cut = String(String.UnicodeScalarView(scalars.prefix(maxLength - 1)))
        while let last = cut.unicodeScalars.last, isSpace(last) { cut.unicodeScalars.removeLast() }
        return cut + "…"
    }

    /// Emoji de tête : drapeau, ou caractère dont le premier point de code est un emoji hors ASCII (séquences ZWJ,
    /// sélecteurs de variante et modificateurs font partie du même caractère).
    static func isLeadingEmoji(_ c: Character) -> Bool {
        guard let first = c.unicodeScalars.first else { return false }
        if (0x1F1E6...0x1F1FF).contains(first.value) { return true }
        return first.value > 0x7F && first.properties.isEmoji
    }

    /// Sans emoji de tête, majuscule initiale ; un slug sans espace (`vivre_maintenant`) voit ses `_` remplacés par des
    /// espaces. Un titre déjà rédigé garde ses `_`. Jamais vide.
    public static func humanize(_ raw: String) -> String {
        let trimmed = trim(raw)
        var rest = Substring(trimmed)
        while let c = rest.first, isLeadingEmoji(c) || c.unicodeScalars.allSatisfy(isSpace) { rest = rest.dropFirst() }
        let noEmoji = String(trim(rest))
        let slug: String
        if noEmoji.unicodeScalars.contains(where: isSpace) {
            slug = noEmoji
        } else {
            slug = trim(noEmoji.split(separator: "_", omittingEmptySubsequences: true).joined(separator: " "))
        }
        guard let first = slug.unicodeScalars.first else { return capLength(trimmed) }
        let head = String(first).uppercased()
        return capLength(head + String(String.UnicodeScalarView(slug.unicodeScalars.dropFirst())))
    }

    /// Dernier segment du chemin, sans `-synthese.md` ni `.md`, `-`/`_` → espaces, puis `humanize`.
    public static func fromFileName(_ fileName: String) -> String {
        let base = fileName.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? fileName
        var stem = base
        if stem.hasSuffix("-synthese.md") { stem.removeLast("-synthese.md".count) } else if stem.hasSuffix(".md") { stem.removeLast(3) }
        var words = ""
        var pendingSpace = false
        for u in stem.unicodeScalars {
            if u == "-" || u == "_" || isSpace(u) {
                pendingSpace = true
            } else {
                if pendingSpace && !words.isEmpty { words.unicodeScalars.append(" ") }
                pendingSpace = false
                words.unicodeScalars.append(u)
            }
        }
        return words.isEmpty ? capLength(base) : humanize(words)
    }

    struct Fence { var char: Character; var length: Int }

    /// Retrait de 0 à 3 espaces, puis la suite de la ligne.
    static func afterIndent(_ line: Substring) -> Substring? {
        let spaces = line.prefix { $0 == " " }.count
        return spaces <= 3 ? line.dropFirst(spaces) : nil
    }

    /// Ouverture d'un bloc de code (``` ou ~~~, 3 minimum). Info string d'un ``` sans backtick (CommonMark).
    static func openingFence(_ line: Substring) -> Fence? {
        guard let rest = afterIndent(line), let c = rest.first, c == "`" || c == "~" else { return nil }
        let run = rest.prefix { $0 == c }.count
        guard run >= 3 else { return nil }
        if c == "`" && rest.dropFirst(run).contains("`") { return nil }
        return Fence(char: c, length: run)
    }

    static func closes(_ line: Substring, _ fence: Fence) -> Bool {
        guard let rest = afterIndent(line), rest.first == fence.char else { return false }
        let run = rest.prefix { $0 == fence.char }.count
        return run >= fence.length && rest.dropFirst(run).allSatisfy { $0 == " " || $0 == "\t" }
    }

    /// Contenu d'un H1 ATX, sans séquence fermante (` ##`), qui doit suivre un espace (`C#` reste intact).
    static func h1Text(_ line: Substring) -> String {
        guard line.first == "#", let second = line.dropFirst().first, second == " " || second == "\t" else { return "" }
        var text = line.dropFirst()
        while let l = text.last, l == " " || l == "\t" { text = text.dropLast() }
        let hashes = text.reversed().prefix { $0 == "#" }.count
        if hashes > 0 {
            let before = text.dropLast(hashes)
            if before.isEmpty || before.last == " " || before.last == "\t" { text = before }
        }
        return String(trim(text))
    }

    /// Premier `# ` H1 (hors BOM, frontmatter et blocs de code) humanisé, sinon nom de fichier humanisé.
    public static func extract(markdown: String, fileName: String) -> String {
        var text = Substring(markdown)
        if text.unicodeScalars.first == "\u{FEFF}" { text = Substring(text.unicodeScalars.dropFirst()) }
        // `\r\n` forme un seul caractère en Swift : découper sur les deux.
        var lines = text.split(omittingEmptySubsequences: false) { $0 == "\n" || $0 == "\r\n" }
        if let first = lines.first, trim(first) == "---" {
            if let end = lines.indices.dropFirst().first(where: { i in
                let l = lines[i]
                let mark = l.hasPrefix("---") ? l.dropFirst(3) : l.hasPrefix("...") ? l.dropFirst(3) : nil
                return mark.map { $0.unicodeScalars.allSatisfy(isSpace) } ?? false
            }) {
                lines = Array(lines[(end + 1)...])
            }
        }
        var fence: Fence?
        for line in lines {
            if let f = fence {
                if closes(line, f) { fence = nil }
                continue
            }
            fence = openingFence(line)
            if fence != nil { continue }
            let title = h1Text(line)
            if !title.isEmpty { return humanize(title) }
        }
        return fromFileName(fileName)
    }
}
