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

    /// Union des révisions par id (une révision est immuable), triées par instant puis id.
    public static func reviews(_ reviews: [Review]) -> [Review] {
        var seen = Set<String>()
        return reviews.filter { seen.insert($0.id).inserted }
            .sorted { ($0.reviewedAt, $0.id) < ($1.reviewedAt, $1.id) }
    }
}
