import Foundation

/// Format v1 du dossier de synchro (spec docs/specs/2026-11-25-app-apple-native.md, « Dossier de synchro »).
public enum SyncFormat {
    public static let version = 1
    public static let rootFolder = "VaultCards"
    public static let formatFile = "format.json"
    public static let devicesFolder = "devices"
    public static let deviceFile = "device.json"
    public static let cardsFile = "cards.jsonl"

    /// `reviews-AAAA-MM.jsonl` : révisions notées ce mois-là (mois UTC de `reviewed_at`).
    public static func reviewsFile(for reviewedAt: Millis) -> String { "reviews-\(ISOTimestamp.month(reviewedAt)).jsonl" }

    /// Chemin d'un fichier relativement à `VaultCards/`.
    public static func path(device: String, file: String) -> String { "\(devicesFolder)/\(device)/\(file)" }

    /// Identifiant d'appareil valide : UUID en minuscules (8-4-4-4-12 chiffres hexadécimaux).
    public static func isDeviceID(_ s: String) -> Bool {
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.map(\.count) == [8, 4, 4, 4, 12] else { return false }
        return parts.allSatisfy { $0.unicodeScalars.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) } }
    }

    public enum FileKind: Equatable, Sendable {
        case device, cards, reviews(month: String)
    }

    /// Nature d'un fichier d'un dossier `devices/<id>/`, nil s'il ne suit pas le format (ex. copie de conflit) : ignoré.
    public static func kind(ofFile name: String) -> FileKind? {
        if name == deviceFile { return .device }
        if name == cardsFile { return .cards }
        guard name.hasPrefix("reviews-"), name.hasSuffix(".jsonl"), name.count == "reviews-AAAA-MM.jsonl".count else { return nil }
        let month = String(name.dropFirst("reviews-".count).prefix(7))
        let c = Array(month.utf8)
        let digit = { (b: UInt8) in b >= 48 && b <= 57 }
        guard c.count == 7, c[4] == 45, [0, 1, 2, 3, 5, 6].allSatisfy({ digit(c[$0]) }) else { return nil }
        guard let m = Int(month.suffix(2)), (1...12).contains(m) else { return nil }
        return .reviews(month: month)
    }
}

/// `format.json`.
public struct FormatInfo: Codable, Equatable, Sendable {
    public var format: String
    public var version: Int
    public static let current = FormatInfo(format: "vault-cards", version: SyncFormat.version)
}

/// `device.json`.
public struct DeviceInfo: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var created_at: String
}

/// Ligne de `cards.jsonl` : instantané complet de la carte au moment `at`. Clés et valeurs exactement celles du fichier.
public struct CardLine: Codable, Equatable, Sendable {
    public var v: Int
    public var id: String
    public var at: String
    public var source: CardSource
    public var status: CardStatus
    public var front: String
    public var back: String
    public var tags: [String]
    public var deleted_at: String?
    public var created_at: String?
    public var deck: String?
    public var source_path: String?
    public var source_title: String?

    public init(card: Card, at: Millis) {
        v = SyncFormat.version
        id = card.id
        self.at = ISOTimestamp.format(at)
        source = card.source
        status = card.status
        front = card.front
        back = card.back
        tags = card.tags
        deleted_at = card.deletedAt.map(ISOTimestamp.format)
        created_at = card.createdAt.map(ISOTimestamp.format)
        deck = card.deck
        source_path = card.sourcePath
        source_title = card.sourceTitle
    }

    enum CodingKeys: String, CodingKey {
        case v, id, at, source, status, front, back, tags, deleted_at, created_at, deck, source_path, source_title
    }

    // Les champs optionnels sont écrits `null` (et non omis), comme dans la spec.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(v, forKey: .v)
        try c.encode(id, forKey: .id)
        try c.encode(at, forKey: .at)
        try c.encode(source, forKey: .source)
        try c.encode(status, forKey: .status)
        try c.encode(front, forKey: .front)
        try c.encode(back, forKey: .back)
        try c.encode(tags, forKey: .tags)
        try c.encode(deleted_at, forKey: .deleted_at)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(deck, forKey: .deck)
        try c.encode(source_path, forKey: .source_path)
        try c.encode(source_title, forKey: .source_title)
    }
}

/// Ligne de `reviews-AAAA-MM.jsonl`.
public struct ReviewLine: Codable, Equatable, Sendable {
    public var v: Int
    public var id: String
    public var card_id: String
    public var rating: Rating
    public var reviewed_at: String
    public var free: Bool?

    public init(review: Review) {
        v = SyncFormat.version
        id = review.id
        card_id = review.cardId
        rating = review.rating
        reviewed_at = ISOTimestamp.format(review.reviewedAt)
        free = review.free
    }
}

/// Changement de carte lu dans le journal d'un appareil.
public struct CardEvent: Equatable, Sendable {
    public var device: String
    public var at: Millis
    public var card: Card
}

public enum LineError: Error, Equatable, Sendable {
    /// Ligne illisible (JSON invalide, champ manquant, valeur hors format) : ignorée et signalée.
    case unreadable(line: Int, reason: String)
    /// Écrite par une version plus récente de l'app : la synchro s'arrête (« Mettez l'app à jour »).
    case newerVersion(line: Int, version: Int)
}

/// Résultat de la lecture d'un journal à partir d'un octet donné.
public struct JournalRead<Item: Sendable>: Sendable {
    public var items: [Item] = []
    public var errors: [LineError] = []
    /// Octets lus jusqu'à la fin de la dernière ligne complète : prochaine lecture à partir de `offset + consumed`.
    public var consumed = 0
    public var needsUpdate: Bool { errors.contains { if case .newerVersion = $0 { return true } else { return false } } }
}

public enum Journal {
    static let newline = UInt8(ascii: "\n")

    /// Encodage d'une ligne : JSON sur une ligne, clés triées, terminé par `\n`.
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(value)
        data.append(newline)
        return data
    }

    /// Découpe `data` en lignes complètes. Une dernière ligne sans `\n` (fichier en cours de téléchargement) n'est pas
    /// lue : elle le sera à la lecture suivante. Les lignes vides sont sautées. `firstLine` numérote les lignes signalées.
    static func lines(_ data: Data, firstLine: Int, _ handle: (Int, Data) -> Void) -> Int {
        var start = data.startIndex
        var number = firstLine
        var consumed = 0
        while let end = data[start...].firstIndex(of: newline) {
            let line = data[start..<end]
            if !line.allSatisfy({ $0 == 32 || $0 == 13 || $0 == 9 }) { handle(number, Data(line)) }
            number += 1
            start = data.index(after: end)
            consumed = data.distance(from: data.startIndex, to: start)
        }
        return consumed
    }

    private struct Version: Decodable { var v: Int }

    static func decodeLine<L: Decodable>(_ type: L.Type, _ line: Data, number: Int) -> Result<L, LineError> {
        let decoder = JSONDecoder()
        guard let version = try? decoder.decode(Version.self, from: line) else {
            return .failure(.unreadable(line: number, reason: "JSON invalide ou champ v absent"))
        }
        if version.v > SyncFormat.version { return .failure(.newerVersion(line: number, version: version.v)) }
        do {
            return .success(try decoder.decode(L.self, from: line))
        } catch {
            return .failure(.unreadable(line: number, reason: "champ manquant ou invalide"))
        }
    }

    /// Lit les changements de cartes d'un `cards.jsonl` écrit par `device`.
    public static func readCards(_ data: Data, device: String, firstLine: Int = 1) -> JournalRead<CardEvent> {
        var read = JournalRead<CardEvent>()
        let consumed = lines(data, firstLine: firstLine) { number, line in
            switch decodeLine(CardLine.self, line, number: number) {
            case .failure(let e): read.errors.append(e)
            case .success(let l):
                guard let at = ISOTimestamp.parse(l.at),
                      let deleted = optionalTime(l.deleted_at), let created = optionalTime(l.created_at) else {
                    read.errors.append(.unreadable(line: number, reason: "horodatage invalide"))
                    return
                }
                guard l.tags.count <= Tags.maxPerCard, l.tags.allSatisfy({ Tags.error($0) == nil }) else {
                    read.errors.append(.unreadable(line: number, reason: "tags invalides"))
                    return
                }
                let card = Card(id: l.id, source: l.source, status: l.status, front: l.front, back: l.back, tags: l.tags,
                                deletedAt: deleted.value, createdAt: created.value, deck: l.deck, sourcePath: l.source_path,
                                sourceTitle: l.source_title)
                read.items.append(CardEvent(device: device, at: at, card: card))
            }
        }
        read.consumed = consumed
        return read
    }

    /// Lit les révisions d'un `reviews-AAAA-MM.jsonl`.
    public static func readReviews(_ data: Data, firstLine: Int = 1) -> JournalRead<Review> {
        var read = JournalRead<Review>()
        let consumed = lines(data, firstLine: firstLine) { number, line in
            switch decodeLine(ReviewLine.self, line, number: number) {
            case .failure(let e): read.errors.append(e)
            case .success(let l):
                guard let at = ISOTimestamp.parse(l.reviewed_at) else {
                    read.errors.append(.unreadable(line: number, reason: "horodatage invalide"))
                    return
                }
                read.items.append(Review(id: l.id, cardId: l.card_id, rating: l.rating, reviewedAt: at, free: l.free ?? false))
            }
        }
        read.consumed = consumed
        return read
    }

    /// nil (champ invalide) ou `.some(valeur)`, où la valeur peut être nil (champ `null`).
    private static func optionalTime(_ s: String?) -> Box<Millis?>? {
        guard let s else { return Box<Millis?>(value: nil) }
        return ISOTimestamp.parse(s).map { Box<Millis?>(value: $0) }
    }

    private struct Box<T> { var value: T }
}
