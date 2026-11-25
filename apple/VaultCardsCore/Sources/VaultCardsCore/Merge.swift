import Foundation

/// Fusion des journaux de tous les appareils (spec, « Ligne de carte » et « Ligne de révision »).
public enum Merge {
    /// Pour chaque carte, le changement au plus grand `(at, device)` l'emporte (dernière écriture gagnante). Une carte
    /// qu'au moins un changement a rendue active ne redevient jamais brouillon.
    public static func cards(_ events: [CardEvent]) -> [String: Card] {
        var winners: [String: CardEvent] = [:]
        var accepted = Set<String>()
        for e in events {
            if e.card.status == .active { accepted.insert(e.card.id) }
            if let w = winners[e.card.id], (w.at, w.device) >= (e.at, e.device) { continue }
            winners[e.card.id] = e
        }
        return winners.mapValues { e in
            var card = e.card
            if card.status == .draft && accepted.contains(card.id) { card.status = .active }
            return card
        }
    }

    /// Carte connue sur un appareil avec son dernier changement `(at, device)`.
    public struct Versioned: Equatable, Sendable {
        public var card: Card
        public var at: Millis
        public var device: String

        public init(card: Card, at: Millis, device: String) {
            self.card = card
            self.at = at
            self.device = device
        }
    }

    /// Applique un changement reçu à la carte locale ; nil si rien ne change. Appliquer tous les changements, dans
    /// n'importe quel ordre, donne le même résultat que `cards(_:)` : tous les appareils convergent.
    public static func apply(_ e: CardEvent, to local: Versioned?) -> Versioned? {
        guard let local else { return Versioned(card: e.card, at: e.at, device: e.device) }
        if (e.at, e.device) > (local.at, local.device) {
            var card = e.card
            if local.card.status == .active { card.status = .active }
            return Versioned(card: card, at: e.at, device: e.device)
        }
        if e.card.status == .active && local.card.status == .draft {
            var accepted = local
            accepted.card.status = .active
            return accepted
        }
        return nil
    }

    /// Union des révisions par id (une révision est immuable), triées par instant puis id.
    public static func reviews(_ reviews: [Review]) -> [Review] {
        var seen = Set<String>()
        return reviews.filter { seen.insert($0.id).inserted }
            .sorted { ($0.reviewedAt, $0.id) < ($1.reviewedAt, $1.id) }
    }
}
