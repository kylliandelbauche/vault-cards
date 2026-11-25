import Foundation
import SwiftData
import VaultCardsCore

/// Carte enregistrée sur l'appareil. `journaled` : pas encore écrite dans le journal de l'appareil (tranche 3).
@Model
final class StoredCard {
    @Attribute(.unique) var id: String
    var source: String
    var status: String
    var front: String
    var back: String
    var tags: [String]
    var deletedAt: Date?
    var createdAt: Date?
    var updatedAt: Date
    var deck: String?
    var sourcePath: String?
    var sourceTitle: String?
    var journaled: Bool

    init(_ card: Card, updatedAt: Date = .now) {
        id = card.id
        source = card.source.rawValue
        status = card.status.rawValue
        front = card.front
        back = card.back
        tags = card.tags
        deletedAt = card.deletedAt.map { Date(millis: $0) }
        createdAt = card.createdAt.map { Date(millis: $0) }
        self.updatedAt = updatedAt
        deck = card.deck
        sourcePath = card.sourcePath
        sourceTitle = card.sourceTitle
        journaled = false
    }

    var card: Card {
        Card(id: id, source: CardSource(rawValue: source) ?? .manual, status: CardStatus(rawValue: status) ?? .active,
             front: front, back: back, tags: tags, deletedAt: deletedAt?.millis, createdAt: createdAt?.millis,
             deck: deck, sourcePath: sourcePath, sourceTitle: sourceTitle)
    }
}

/// Révision notée sur l'appareil (immuable).
@Model
final class StoredReview {
    @Attribute(.unique) var id: String
    var cardId: String
    var rating: Int
    var reviewedAt: Date
    var free: Bool
    var journaled: Bool

    init(_ review: Review) {
        id = review.id
        cardId = review.cardId
        rating = review.rating.rawValue
        reviewedAt = Date(millis: review.reviewedAt)
        free = review.free
        journaled = false
    }

    var review: Review? {
        Rating(rawValue: rating).map { Review(id: id, cardId: cardId, rating: $0, reviewedAt: reviewedAt.millis, free: free) }
    }
}

enum Device {
    /// Identifiant de l'appareil (UUID en minuscules), créé au premier lancement.
    static var id: String {
        let key = "deviceID"
        if let id = UserDefaults.standard.string(forKey: key), SyncFormat.isDeviceID(id) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: key)
        return id
    }
}

enum CardDraftError: LocalizedError, Equatable {
    case emptyFront, emptyBack, noTag, tooManyTags, badTag(String)

    var errorDescription: String? {
        switch self {
        case .emptyFront: return "La question est vide."
        case .emptyBack: return "La réponse est vide."
        case .noTag: return "Ajoute au moins un tag."
        case .tooManyTags: return "\(Tags.maxPerCard) tags au plus."
        case .badTag(let message): return message.prefix(1).uppercased() + message.dropFirst() + "."
        }
    }
}

/// Tags saisis séparés par des virgules : normalisés, validés, doublons de casse retirés (le premier gardé).
func parseTags(_ text: String) throws -> [String] {
    var seen = Set<String>()
    var tags: [String] = []
    for part in text.split(separator: ",") {
        let name = Tags.normalize(String(part))
        if name.isEmpty { continue }
        if let error = Tags.error(name) { throw CardDraftError.badTag(error) }
        if seen.insert(Tags.key(name)).inserted { tags.append(name) }
    }
    if tags.isEmpty { throw CardDraftError.noTag }
    if tags.count > Tags.maxPerCard { throw CardDraftError.tooManyTags }
    return tags
}
