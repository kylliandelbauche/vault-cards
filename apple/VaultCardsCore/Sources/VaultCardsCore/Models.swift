import Foundation

/// Note donnée en révision : 1 Again · 2 Hard · 3 Good (comme la PWA, sans Easy).
public enum Rating: Int, Codable, Sendable, CaseIterable {
    case again = 1, hard = 2, good = 3

    var grade: Grade {
        switch self {
        case .again: return .again
        case .hard: return .hard
        case .good: return .good
        }
    }
}

/// Origine d'une carte : générée depuis une note, écrite à la main, ou proposée par l'IA (d'abord en brouillon).
public enum CardSource: String, Codable, Sendable {
    case vault, manual, inbox
}

/// `draft` : brouillon pas encore accepté, exclu des sessions, compteurs et tags. Une carte active ne redevient jamais brouillon.
public enum CardStatus: String, Codable, Sendable {
    case active, draft
}

public struct Card: Equatable, Sendable, Identifiable {
    public var id: String
    public var source: CardSource
    public var status: CardStatus
    public var front: String
    public var back: String
    /// Noms de tags libres, 0 à 5 (au moins 1 pour une carte manuelle), le 1er est le principal.
    public var tags: [String]
    public var deletedAt: Millis?
    public var createdAt: Millis?
    /// Note source (cartes `vault`) ; nil pour une carte manuelle.
    public var deck: String?
    public var sourcePath: String?
    public var sourceTitle: String?

    public init(id: String, source: CardSource, status: CardStatus = .active, front: String, back: String, tags: [String],
                deletedAt: Millis? = nil, createdAt: Millis? = nil, deck: String? = nil, sourcePath: String? = nil,
                sourceTitle: String? = nil) {
        self.id = id
        self.source = source
        self.status = status
        self.front = front
        self.back = back
        self.tags = tags
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.deck = deck
        self.sourcePath = sourcePath
        self.sourceTitle = sourceTitle
    }

    /// Carte à réviser : non supprimée et pas un brouillon.
    public var isLive: Bool { deletedAt == nil && status != .draft }
}

public struct Review: Equatable, Sendable, Identifiable {
    public var id: String
    public var cardId: String
    public var rating: Rating
    public var reviewedAt: Millis
    /// Notée en révision libre (« Réviser à nouveau ») : sa première note ne consomme pas le quota de nouvelles du jour.
    public var free: Bool

    public init(id: String, cardId: String, rating: Rating, reviewedAt: Millis, free: Bool = false) {
        self.id = id
        self.cardId = cardId
        self.rating = rating
        self.reviewedAt = reviewedAt
        self.free = free
    }
}
