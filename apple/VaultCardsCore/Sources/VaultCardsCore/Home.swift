import Foundation

/// Un tag avec son nombre de cartes vivantes et sa file du jour (quota de nouvelles global), comme `TagCount` de
/// src/lib/home.ts. L'app native n'a pas de registre de tags : seuls les tags des cartes vivantes existent.
public struct TagCount: Equatable, Sendable {
    public var name: String
    public var total: Int
    public var today: Int

    public init(name: String, total: Int, today: Int) {
        self.name = name
        self.total = total
        self.today = today
    }
}

public extension Tags {
    /// Tri A–Z français sans casse ni accents (`byTagName` de shared/tags.ts).
    static func byName(_ a: String, _ b: String) -> Bool {
        let fr = Locale(identifier: "fr")
        let base = a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], locale: fr)
        return base == .orderedSame ? a.compare(b, locale: fr) == .orderedAscending : base == .orderedAscending
    }

    /// Noms des tags des cartes vivantes, un par clé (première forme rencontrée), A–Z.
    static func knownNames(_ cards: [Card]) -> [String] {
        var byKey: [String: String] = [:]
        for card in cards where card.isLive {
            for name in card.tags where byKey[key(name)] == nil { byKey[key(name)] = normalize(name) }
        }
        return byKey.values.sorted(by: byName)
    }

    /// Nombre de cartes décroissant (vides en dernier), A–Z à égalité (`sortTags`).
    static func sorted(_ tags: [TagCount]) -> [TagCount] {
        tags.sorted { $0.total != $1.total ? $0.total > $1.total : byName($0.name, $1.name) }
    }

    /// Raccourcis de l'accueil : tags non vides, triés (`shortcutTags`).
    static func shortcuts(_ tags: [TagCount]) -> [TagCount] { sorted(tags).filter { $0.total > 0 } }
}

/// Compteurs par tag : cartes vivantes et file du jour du tag (celle de la session lancée sur ce tag).
public func tagCounts(_ cards: [Card], _ reviews: [Review], now: Millis, newLimit: Int = newPerDay,
                      calendar: Calendar = .current) -> [TagCount] {
    let grouped = byCard(reviews)
    let items = scheduleItems(cards, grouped)
    return Tags.knownNames(cards).map { name in
        TagCount(name: name, total: items.filter { $0.card.hasTag(name) }.count,
                 today: queueOf(items, grouped, now: now, newLimit: newLimit, tag: name, calendar: calendar).count)
    }
}
