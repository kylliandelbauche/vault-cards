import Foundation

/// Règles des tags libres, alignées sur shared/tags.ts de la PWA.
public enum Tags {
    public static let maxPerCard = 5
    public static let nameMaxLength = 40

    /// Les « espaces » de `trim()` en JavaScript (TAG_SPACE_CLASS de shared/tags.ts).
    static func isSpace(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    /// Forme stockée : NFC, espaces de bord retirés, espaces internes réduits à un seul.
    public static func normalize(_ name: String) -> String {
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for u in name.precomposedStringWithCanonicalMapping.unicodeScalars {
            if isSpace(u) {
                pendingSpace = !out.isEmpty
            } else {
                if pendingSpace { out.append(" ") }
                pendingSpace = false
                out.append(u)
            }
        }
        return String(out)
    }

    /// Clé d'unicité : un même tag quelle que soit la casse ou l'espacement.
    public static func key(_ name: String) -> String { normalize(name).lowercased() }

    public static func same(_ a: String, _ b: String) -> Bool { key(a) == key(b) }

    /// Message d'erreur si le nom (déjà normalisé) est refusé, sinon nil.
    public static func error(_ name: String) -> String? {
        if name.isEmpty { return "nom de tag vide" }
        if name.unicodeScalars.contains(where: { $0.value < 0x20 || (0x7F...0x9F).contains($0.value) }) {
            return "nom de tag invalide « \(name) »"
        }
        let n = name.unicodeScalars.count
        if n > nameMaxLength { return "nom de tag trop long « \(name) » (\(n) > \(nameMaxLength) caractères)" }
        return nil
    }
}

public extension Card {
    /// La carte porte ce tag, casse et espaces ignorés.
    func hasTag(_ tag: String) -> Bool {
        let k = Tags.key(tag)
        return tags.contains { Tags.key($0) == k }
    }
}
