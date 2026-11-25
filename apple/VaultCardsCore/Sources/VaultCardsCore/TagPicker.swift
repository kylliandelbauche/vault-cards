import Foundation

/// Un tag et son nombre de cartes vivantes (`TagChoice` de src/lib/tags.ts).
public struct TagChoice: Equatable, Sendable {
    public var name: String
    public var cards: Int

    public init(name: String, cards: Int) {
        self.name = name
        self.cards = cards
    }
}

public extension Tags {
    /// Liste de « Ajouter des tags » : chaque tag des cartes vivantes et son nombre de cartes, A–Z (`tagChoices`).
    static func choices(_ cards: [Card]) -> [TagChoice] {
        var counts: [String: Int] = [:]
        for card in cards where card.isLive {
            for k in Set(card.tags.map(key)) { counts[k, default: 0] += 1 }
        }
        return knownNames(cards).map { TagChoice(name: $0, cards: counts[key($0)] ?? 0) }
    }

    /// Lettre d'index : première lettre sans accent, « # » si ce n'est pas une lettre A–Z (`indexLetter`).
    static func indexLetter(_ name: String) -> String {
        let first = name.folding(options: .diacriticInsensitive, locale: nil).prefix(1).uppercased()
        return first.count == 1 && ("A"..."Z").contains(first) ? first : "#"
    }
}

/// Choix des tags d'une carte (AddTagsScreen de la PWA) : rien n'est écrit ici, la liste revient au formulaire.
public struct TagSelection: Equatable, Sendable {
    public private(set) var selected: [String]

    public init(_ selected: [String]) { self.selected = selected }

    public var isFull: Bool { selected.count >= Tags.maxPerCard }

    public func contains(_ name: String) -> Bool { selected.contains { Tags.same($0, name) } }

    public static var fullMessage: String { "\(Tags.maxPerCard) tags au maximum par carte." }

    /// Ajoute ou retire ; rend un message si la carte a déjà 5 tags.
    public mutating func toggle(_ name: String) -> String? {
        if contains(name) {
            selected.removeAll { Tags.same($0, name) }
            return nil
        }
        if isFull { return Self.fullMessage }
        selected.append(name)
        return nil
    }

    /// Crée le tag tapé et l'ajoute en tête ; rend un message si le nom est refusé ou la carte pleine.
    public mutating func create(_ query: String) -> String? {
        let name = Tags.normalize(query)
        if let problem = Tags.error(name) { return problem.prefix(1).uppercased() + problem.dropFirst() + "." }
        if contains(name) { return nil }
        if isFull { return Self.fullMessage }
        selected.insert(name, at: 0)
        return nil
    }

    /// Lignes de la liste : tags connus + noms de la carte pas encore créés, filtrés par la recherche, A–Z.
    public func rows(_ choices: [TagChoice], query: String) -> [TagChoice] {
        var list = choices
        for name in selected where !list.contains(where: { Tags.same($0.name, name) }) {
            list.append(TagChoice(name: name, cards: 0))
        }
        let q = Tags.key(query)
        return list.filter { q.isEmpty || Tags.key($0.name).contains(q) }.sorted { Tags.byName($0.name, $1.name) }
    }

    /// « Créer « … » » est proposé : recherche non vide et aucun tag de même nom.
    public func canCreate(_ choices: [TagChoice], query: String) -> Bool {
        let q = Tags.key(query)
        return !q.isEmpty && !rows(choices, query: "").contains { Tags.key($0.name) == q }
    }
}
