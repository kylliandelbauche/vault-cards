import XCTest
@testable import VaultCardsCore

/// Mêmes cas que src/lib/myCards.test.ts ; sans `inbox_id`, un document = les cartes `inbox` de même titre.
final class MyCardsTests: XCTestCase {
    func iso(_ s: String) -> Millis { ISOTimestamp.parse(s)! }
    func card(_ id: String, front: String? = nil, back: String? = nil, tags: [String] = ["Mémoire"],
              created: String? = "2026-10-01T00:00:00Z", deleted: String? = nil) -> Card {
        Card(id: id, source: .vault, front: front ?? "Question \(id) ?", back: back ?? "Réponse \(id).", tags: tags,
             deletedAt: deleted.map(iso), createdAt: created.map(iso), deck: "x", sourcePath: "x/\(id).md",
             sourceTitle: "Note \(id)")
    }
    func inbox(_ id: String, _ title: String?, _ created: String, status: CardStatus = .active, front: String? = nil,
               back: String? = nil, tags: [String] = ["Mémoire"]) -> Card {
        Card(id: id, source: .inbox, status: status, front: front ?? "Question \(id) ?", back: back ?? "Réponse \(id).",
             tags: tags, createdAt: iso(created), sourceTitle: title)
    }

    func testFold() {
        XCTAssertEqual(MyCards.fold("Éléphant À Noël"), "elephant a noel")
        XCTAssertEqual(MyCards.fold("Cœur ÆTHER"), "coeur aether")
    }

    func testExcludesDraftsAndDeletedNewestFirst() {
        let index = MyCards.index([
            card("a", created: "2026-10-01T00:00:00Z"),
            card("b", created: "2026-10-03T00:00:00Z"),
            inbox("d", "Cours.pdf", "2026-10-04T00:00:00Z", status: .draft),
            card("x", deleted: "2026-10-05T00:00:00Z"),
            card("c", created: nil),
        ], updatedAt: { $0.id == "c" ? self.iso("2026-10-02T00:00:00Z") : 0 })
        XCTAssertEqual(index.cards.map(\.card.id), ["b", "c", "a"])
    }

    func testDocumentsGroupActiveInboxCardsByTitleNewestFirst() {
        var manual = card("m")
        manual.source = .manual
        manual.sourceTitle = nil
        let index = MyCards.index([
            card("v"), manual,
            inbox("p1", "Cours FSRS.pdf", "2026-10-10T00:00:00Z"),
            inbox("p2", "Cours FSRS.pdf", "2026-10-11T00:00:00Z"),
            inbox("f1", "  Photo du 18/10 ", "2026-10-18T00:00:00Z"),
            inbox("n1", nil, "2026-10-01T00:00:00Z"),
            inbox("d1", "Vocal du 12/10", "2026-10-20T00:00:00Z", status: .draft),
        ])
        XCTAssertEqual(index.documents, [
            .init(label: "Photo du 18/10", count: 1),
            .init(label: "Cours FSRS.pdf", count: 2),
            .init(label: MyCards.untitledDocument, count: 1),
        ])
    }

    lazy var indexed = MyCards.index([
        card("a", front: "Qu’est-ce que la répétition espacée ?", back: "Revoir avant d’oublier.", tags: ["Mémoire"]),
        card("b", front: "Trois valeurs de FSRS ?", back: "Stabilité, difficulté, récupérabilité.", tags: ["Algorithmes"]),
        inbox("c", "Cours FSRS.pdf", "2026-10-10T00:00:00Z", front: "Stabilité ?", back: "Jours avant 90 %.", tags: ["FSRS"]),
        inbox("d", "Photo du 18/10", "2026-10-18T00:00:00Z", front: "RLS ?", back: "Ses propres lignes.", tags: ["Sécurité"]),
    ]).cards
    func ids(_ q: String, _ doc: String? = nil) -> [String] {
        MyCards.filter(indexed, query: q, document: doc).map(\.card.id).sorted()
    }

    func testEmptyQueryKeepsEverything() { XCTAssertEqual(ids(""), ["a", "b", "c", "d"]) }

    func testIgnoresCaseAndAccentsBothWays() {
        XCTAssertEqual(ids("REPETITION"), ["a"])
        XCTAssertEqual(ids("stabilite"), ["b", "c"])
        XCTAssertEqual(ids("Sécu"), ["d"])
        XCTAssertEqual(ids("securite"), ["d"])
    }

    func testSearchesQuestionAnswerTagsAndDocumentAllWordsAnyOrder() {
        XCTAssertEqual(ids("oublier"), ["a"])
        XCTAssertEqual(ids("algorithmes"), ["b"])
        XCTAssertEqual(ids("fsrs.pdf"), ["c"])
        XCTAssertEqual(ids("photo 18/10"), ["d"])
        XCTAssertEqual(ids("jours stabilité"), ["c"])
        XCTAssertEqual(ids("jours rls"), [])
    }

    func testCombinesWithTheChosenDocument() {
        XCTAssertEqual(ids("", "Cours FSRS.pdf"), ["c"])
        XCTAssertEqual(ids("stabilite", "Cours FSRS.pdf"), ["c"])
        XCTAssertEqual(ids("rls", "Cours FSRS.pdf"), [])
    }

    func testAVaultNoteTitleIsNotADocumentName() { XCTAssertEqual(ids("note a"), []) }
}
