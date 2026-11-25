import Foundation

/// « Mes cartes » sans interface, comme src/lib/myCards.ts : liste, documents importés et recherche, tout en local.
/// Le format v1 n'a pas d'`inbox_id` : un document est l'ensemble des cartes `inbox` de même titre.
public enum MyCards {
    /// Libellé d'un document dont les cartes n'ont pas de titre.
    public static let untitledDocument = "Document importé"

    /// Texte replié pour la recherche : sans accents ni casse, ligatures œ / æ développées (`foldText`).
    public static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr"))
            .lowercased()
            .replacingOccurrences(of: "œ", with: "oe")
            .replacingOccurrences(of: "æ", with: "ae")
    }

    /// Nom du document d'une carte de la boîte de réception ; nil pour une carte du vault ou manuelle.
    public static func documentLabel(_ card: Card) -> String? {
        guard card.source == .inbox else { return nil }
        let title = SourceTitle.trim(card.sourceTitle ?? "")
        return title.isEmpty ? untitledDocument : title
    }

    public struct Document: Equatable, Sendable {
        public var label: String
        public var count: Int
    }

    public struct Indexed: Equatable, Sendable {
        public var card: Card
        /// Question, réponse, tags et nom du document, repliés.
        public var text: String
    }

    public struct Index: Equatable, Sendable {
        /// Cartes affichées, les plus récentes d'abord.
        public var cards: [Indexed]
        /// Documents importés, le plus récent d'abord.
        public var documents: [Document]
    }

    /// Exclut brouillons et cartes supprimées, regroupe les documents, replie le texte. `updatedAt` : repli quand une
    /// carte n'a pas de date de création.
    public static func index(_ all: [Card], updatedAt: (Card) -> Millis = { _ in 0 }) -> Index {
        func stamp(_ c: Card) -> Millis { c.createdAt ?? updatedAt(c) }
        let listed = all.filter(\.isLive).sorted { stamp($0) != stamp($1) ? stamp($0) > stamp($1) : $0.id < $1.id }
        var order: [String] = []
        var counts: [String: Int] = [:]
        var latest: [String: Millis] = [:]
        let cards = listed.map { card -> Indexed in
            let label = documentLabel(card)
            if let label {
                if counts[label] == nil { order.append(label); latest[label] = stamp(card) }
                counts[label, default: 0] += 1
            }
            return Indexed(card: card, text: fold(([card.front, card.back] + card.tags + [label ?? ""]).joined(separator: "\n")))
        }
        let documents = order
            .sorted { latest[$0]! != latest[$1]! ? latest[$0]! > latest[$1]! : Tags.byName($0, $1) }
            .map { Document(label: $0, count: counts[$0]!) }
        return Index(cards: cards, documents: documents)
    }

    /// Cartes qui ont tous les mots de la recherche (tout ordre, sans accents ni casse) et sont du document choisi
    /// (`document` nil : « Tous »).
    public static func filter(_ index: [Indexed], query: String, document: String?) -> [Indexed] {
        let words = fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        if words.isEmpty && document == nil { return index }
        return index.filter { item in
            (document == nil || documentLabel(item.card) == document) && words.allSatisfy { item.text.contains($0) }
        }
    }
}
