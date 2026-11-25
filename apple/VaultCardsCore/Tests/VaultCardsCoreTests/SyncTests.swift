import XCTest
@testable import VaultCardsCore

/// Dossier synchronisé en mémoire (le même pour tous les appareils, comme un dossier iCloud Drive à jour).
final class MemoryFolder: SyncFolder {
    var files: [String: Data] = [:]
    var directories: Set<String> = []

    func read(_ path: String) throws -> Data? { files[path] }

    func list(_ directory: String) throws -> [String] {
        let prefix = directory + "/"
        let entries = (Array(files.keys) + Array(directories)).filter { $0.hasPrefix(prefix) }
            .map { String($0.dropFirst(prefix.count).split(separator: "/")[0]) }
        return Array(Set(entries))
    }

    func append(_ data: Data, to path: String) throws { files[path, default: Data()].append(data) }
    func write(_ data: Data, to path: String) throws { files[path] = data }
    func makeDirectory(_ path: String) throws { directories.insert(path) }

    func text(_ path: String) -> String { String(decoding: files[path] ?? Data(), as: UTF8.self) }
}

/// Appareil simulé : même logique que l'app (base locale, changements en attente, fusion avec `Merge.apply`).
struct Replica {
    let device: String
    var cards: [String: Merge.Versioned] = [:]
    var reviews: [String: Review] = [:]
    var pendingCards: Set<String> = []
    var pendingReviews: Set<String> = []
    var offsets: [String: Int] = [:]
    var problems: [String] = []

    init(_ device: String) { self.device = device }

    mutating func edit(_ card: Card, at: Millis) {
        cards[card.id] = Merge.Versioned(card: card, at: at, device: device)
        pendingCards.insert(card.id)
    }

    mutating func review(_ r: Review) {
        reviews[r.id] = r
        pendingReviews.insert(r.id)
    }

    @discardableResult
    mutating func sync(_ folder: SyncFolder, now: Millis = 0) throws -> SyncOutput {
        let input = SyncInput(device: device, deviceName: "Appareil de test", now: now,
                              pendingCards: pendingCards.sorted().map { CardEvent(device: device, at: cards[$0]!.at, card: cards[$0]!.card) },
                              pendingReviews: pendingReviews.sorted().map { reviews[$0]! }, offsets: offsets)
        let out = try FolderSync.run(folder, input)
        if out.wrotePending {
            pendingCards = []
            pendingReviews = []
        }
        for e in out.incomingCards {
            if let v = Merge.apply(e, to: cards[e.card.id]) { cards[e.card.id] = v }
        }
        for r in out.incomingReviews where reviews[r.id] == nil { reviews[r.id] = r }
        offsets = out.offsets
        problems = out.problems
        return out
    }

    var merged: [String: Card] { cards.mapValues(\.card) }
    func history(_ id: String) -> [Review] { Merge.reviews(Array(reviews.values)).filter { $0.cardId == id } }
}

final class SyncTests: XCTestCase {
    let iphone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    let mac = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

    func card(_ front: String, id: String = "c1", status: CardStatus = .active, deleted: Millis? = nil) -> Card {
        Card(id: id, source: .manual, status: status, front: front, back: "R", tags: ["IA"], deletedAt: deleted, createdAt: 1)
    }

    func testFirstSyncCreatesTheFolderLayout() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone)
        a.edit(card("Q"), at: 10)
        try a.sync(folder, now: 1_764_076_589_123)
        XCTAssertEqual(folder.text("format.json"), "{\"format\":\"vault-cards\",\"version\":1}\n")
        XCTAssertTrue(folder.text("devices/\(iphone)/device.json").contains("\"created_at\":\"2025-11-25T13:16:29.123Z\""))
        XCTAssertEqual(folder.text("devices/\(iphone)/cards.jsonl").split(separator: "\n").count, 1)
        // Une deuxième synchro sans changement n'écrit rien de plus.
        try a.sync(folder)
        XCTAssertEqual(folder.text("devices/\(iphone)/cards.jsonl").split(separator: "\n").count, 1)
    }

    func testCardCreatedOnOneDeviceAppearsOnTheOther() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("Question"), at: 10)
        try a.sync(folder)
        try b.sync(folder)
        XCTAssertEqual(b.merged["c1"]?.front, "Question")
        XCTAssertEqual(b.pendingCards, [], "une carte reçue n'est pas réécrite dans le journal du Mac")
        XCTAssertNil(folder.files["devices/\(mac)/cards.jsonl"])
    }

    func testEditsAndDeletionTravelBothWays() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("v1"), at: 10)
        try a.sync(folder)
        try b.sync(folder)
        b.edit(card("v2"), at: 20)
        try b.sync(folder)
        try a.sync(folder)
        XCTAssertEqual(a.merged["c1"]?.front, "v2")
        a.edit(card("v2", deleted: 30), at: 30)
        try a.sync(folder)
        try b.sync(folder)
        XCTAssertEqual(b.merged["c1"]?.deletedAt, 30)
    }

    func testConcurrentEditsConvergeToTheLatest() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("iphone"), at: 20)
        b.edit(card("mac"), at: 15)
        try a.sync(folder)
        try b.sync(folder)  // Le Mac écrit sa version (plus ancienne) puis reçoit celle de l'iPhone.
        try a.sync(folder)
        XCTAssertEqual(a.merged, b.merged)
        XCTAssertEqual(a.merged["c1"]?.front, "iphone")
        // Même résultat que la fusion de tous les journaux d'un coup.
        let all = Journal.readCards(folder.files["devices/\(iphone)/cards.jsonl"]!, device: iphone).items
            + Journal.readCards(folder.files["devices/\(mac)/cards.jsonl"]!, device: mac).items
        XCTAssertEqual(Merge.cards(all), a.merged)
    }

    func testAcceptedDraftStaysActiveEverywhere() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("brouillon", status: .draft), at: 10)
        try a.sync(folder)
        try b.sync(folder)
        b.edit(card("brouillon", status: .active), at: 20)  // accepté sur le Mac
        a.edit(card("retouche", status: .draft), at: 30)     // retouché, encore brouillon, sur l'iPhone
        try b.sync(folder)
        try a.sync(folder)
        try b.sync(folder)
        XCTAssertEqual(a.merged, b.merged)
        XCTAssertEqual(a.merged["c1"]?.status, .active)
        XCTAssertEqual(a.merged["c1"]?.front, "retouche")
    }

    func testReviewsOfBothDevicesCount() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("Q"), at: 10)
        try a.sync(folder)
        try b.sync(folder)
        let day = dayMillis
        a.review(Review(id: "r1", cardId: "c1", rating: .good, reviewedAt: 1_764_000_000_000))
        b.review(Review(id: "r2", cardId: "c1", rating: .again, reviewedAt: 1_764_000_000_000 + day))
        b.review(Review(id: "r3", cardId: "c1", rating: .good, reviewedAt: 1_767_225_600_000))  // janvier 2026
        try a.sync(folder)
        try b.sync(folder)
        try a.sync(folder)
        XCTAssertEqual(a.history("c1").map(\.id), ["r1", "r2", "r3"])
        XCTAssertEqual(stateFromReviews(a.history("c1")), stateFromReviews(b.history("c1")))
        XCTAssertNotNil(folder.files["devices/\(mac)/reviews-2025-11.jsonl"])
        XCTAssertNotNil(folder.files["devices/\(mac)/reviews-2026-01.jsonl"])
    }

    func testIncrementalReadAndIncompleteLastLine() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("v1"), at: 10)
        try a.sync(folder)
        let path = "devices/\(iphone)/cards.jsonl"
        let complete = folder.files[path]!
        // Ligne suivante encore en cours de téléchargement : pas encore lue.
        let next = try Journal.encode(CardLine(card: card("v2"), at: 20))
        folder.files[path] = complete + next.prefix(20)
        try b.sync(folder)
        XCTAssertEqual(b.merged["c1"]?.front, "v1")
        XCTAssertEqual(b.offsets[path], complete.count)
        folder.files[path] = complete + next
        let out = try b.sync(folder)
        XCTAssertEqual(out.incomingCards.map(\.card.front), ["v2"], "seule la nouvelle ligne est lue")
        XCTAssertEqual(b.merged["c1"]?.front, "v2")
        // Fichier rétréci (remplacé) : relu depuis le début.
        folder.files[path] = complete
        XCTAssertEqual(try b.sync(folder).incomingCards.map(\.card.front), ["v1"])
        XCTAssertEqual(b.merged["c1"]?.front, "v2", "une ligne plus ancienne ne revient pas en arrière")
    }

    func testBadLinesAndConflictCopiesAreIgnored() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("Q"), at: 10)
        try a.sync(folder)
        let path = "devices/\(iphone)/cards.jsonl"
        folder.files[path]!.append(Data("pas du json\n".utf8))
        a.edit(card("Q2"), at: 20)
        try a.sync(folder)
        folder.files["devices/\(iphone)/cards 2.jsonl"] = try Journal.encode(CardLine(card: card("copie"), at: 99))
        folder.files["devices/pas-un-appareil/cards.jsonl"] = try Journal.encode(CardLine(card: card("intrus"), at: 99))
        try b.sync(folder)
        XCTAssertEqual(b.merged["c1"]?.front, "Q2")
        XCTAssertEqual(b.problems, ["Appareil de test, cards.jsonl, ligne 2 : JSON invalide ou champ v absent."])
    }

    func testNewerVersionStopsWithoutLosingData() throws {
        let folder = MemoryFolder()
        var a = Replica(iphone), b = Replica(mac)
        a.edit(card("Q"), at: 10)
        try a.sync(folder)
        let path = "devices/\(iphone)/cards.jsonl"
        folder.files[path]!.append(Data("{\"v\":2,\"id\":\"c1\"}\n".utf8))
        let out = try b.sync(folder)
        XCTAssertTrue(out.needsUpdate)
        XCTAssertNil(b.offsets[path], "le fichier sera relu une fois l'app à jour")

        // Dossier d'une version plus récente : rien n'est écrit, les changements restent en attente.
        folder.files["format.json"] = Data("{\"format\":\"vault-cards\",\"version\":2}\n".utf8)
        b.edit(card("Mac"), at: 50)
        let stopped = try b.sync(folder)
        XCTAssertTrue(stopped.needsUpdate)
        XCTAssertFalse(stopped.wrotePending)
        XCTAssertEqual(b.pendingCards, ["c1"])
        XCTAssertNil(folder.files["devices/\(mac)/cards.jsonl"])
    }

    func testForeignFolderIsRefused() {
        let folder = MemoryFolder()
        folder.files["format.json"] = Data("{\"format\":\"autre\",\"version\":1}".utf8)
        var a = Replica(iphone)
        XCTAssertThrowsError(try a.sync(folder)) { XCTAssertEqual($0 as? SyncError, .foreignFolder) }
    }

    func testApplyIsOrderIndependent() {
        let events = [
            CardEvent(device: iphone, at: 10, card: card("a", status: .draft)),
            CardEvent(device: mac, at: 20, card: card("b", status: .active)),
            CardEvent(device: iphone, at: 30, card: card("c", status: .draft)),
            CardEvent(device: mac, at: 30, card: card("d", status: .draft, deleted: 30)),
        ]
        let expected = Merge.cards(events)["c1"]
        for order in [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]] {
            var local: Merge.Versioned?
            for i in order { if let v = Merge.apply(events[i], to: local) { local = v } }
            XCTAssertEqual(local?.card, expected)
        }
        XCTAssertEqual(expected?.front, "d")
        XCTAssertEqual(expected?.status, .active)
    }
}
