import XCTest
@testable import VaultCardsCore

final class FormatTests: XCTestCase {
    let device = "0f8c1c2e-1b7a-4c1e-9d55-3f1b2a4c5d6e"

    func testTimestampRoundTrip() {
        let ms = ISOTimestamp.parse("2026-11-25T13:16:29.123Z")!
        XCTAssertEqual(ISOTimestamp.format(ms), "2026-11-25T13:16:29.123Z")
        XCTAssertEqual(ms, Date(millis: ms).millis)
        XCTAssertEqual(ISOTimestamp.parse("2026-11-25T13:16:29Z"), ms - 123)
        XCTAssertEqual(ISOTimestamp.parse("2026-11-25T13:16:29.123456+00:00"), ms)
        XCTAssertEqual(ISOTimestamp.format(0), "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(ISOTimestamp.format(-1), "1969-12-31T23:59:59.999Z")
        XCTAssertNil(ISOTimestamp.parse("2026-02-30T00:00:00Z"))
        XCTAssertNil(ISOTimestamp.parse("2026-11-25 13:16:29Z"))
        XCTAssertNil(ISOTimestamp.parse("2026-11-25T13:16:29+01:00"))
        XCTAssertEqual(ISOTimestamp.month(ms), "2026-11")
        // Même valeur que Date.parse en JavaScript.
        XCTAssertEqual(ISOTimestamp.parse("2024-02-29T12:00:00.000Z"), 1_709_208_000_000)
    }

    func testCardLineRoundTripWritesNulls() throws {
        let card = Card(id: "c1", source: .manual, front: "Q / é", back: "R", tags: ["IA"], createdAt: 1_000)
        let data = try Journal.encode(CardLine(card: card, at: 2_000))
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.hasSuffix("}\n"))
        XCTAssertTrue(text.contains("\"deleted_at\":null"))
        XCTAssertTrue(text.contains("\"front\":\"Q / é\""))
        let read = Journal.readCards(data, device: device)
        XCTAssertEqual(read.errors, [])
        XCTAssertEqual(read.items, [CardEvent(device: device, at: 2_000, card: card)])
        XCTAssertEqual(read.consumed, data.count)
    }

    func testReviewLineRoundTrip() throws {
        let r = Review(id: "r1", cardId: "c1", rating: .hard, reviewedAt: 1_764_076_589_123, free: true)
        let data = try Journal.encode(ReviewLine(review: r))
        XCTAssertEqual(Journal.readReviews(data).items, [r])
        XCTAssertEqual(SyncFormat.reviewsFile(for: r.reviewedAt), "reviews-2025-11.jsonl")
    }

    func testIncompleteLastLineIsLeftForLater() throws {
        let line = try Journal.encode(ReviewLine(review: Review(id: "r1", cardId: "c", rating: .good, reviewedAt: 0)))
        let partial = line + Data("{\"v\":1,\"id\":\"r2\"".utf8)
        let read = Journal.readReviews(partial)
        XCTAssertEqual(read.items.map(\.id), ["r1"])
        XCTAssertEqual(read.errors, [])
        XCTAssertEqual(read.consumed, line.count)
    }

    func testBadLinesAreSkippedAndReported() {
        let text = """
        not json
        {"v":1,"id":"r1","card_id":"c","rating":7,"reviewed_at":"2026-01-01T00:00:00.000Z"}
        {"v":1,"id":"r2","card_id":"c","rating":3,"reviewed_at":"hier"}

        {"v":1,"id":"r3","card_id":"c","rating":3,"reviewed_at":"2026-01-01T00:00:00.000Z","extra":"ignoré"}

        """
        let read = Journal.readReviews(Data(text.utf8))
        XCTAssertEqual(read.items.map(\.id), ["r3"])
        XCTAssertEqual(read.errors.count, 3)
        XCTAssertFalse(read.needsUpdate)
    }

    func testNewerVersionStopsSync() {
        let read = Journal.readReviews(Data("{\"v\":2,\"id\":\"r\"}\n".utf8))
        XCTAssertTrue(read.needsUpdate)
        XCTAssertEqual(read.errors, [.newerVersion(line: 1, version: 2)])
    }

    func testInvalidTagsRejected() {
        let line = "{\"v\":1,\"id\":\"c\",\"at\":\"2026-01-01T00:00:00.000Z\",\"source\":\"manual\",\"status\":\"active\","
            + "\"front\":\"f\",\"back\":\"b\",\"tags\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]}\n"
        XCTAssertEqual(Journal.readCards(Data(line.utf8), device: device).items, [])
    }

    func testFileNames() {
        XCTAssertTrue(SyncFormat.isDeviceID(device))
        XCTAssertFalse(SyncFormat.isDeviceID(device.uppercased()))
        XCTAssertFalse(SyncFormat.isDeviceID("abc"))
        XCTAssertEqual(SyncFormat.kind(ofFile: "cards.jsonl"), .cards)
        XCTAssertEqual(SyncFormat.kind(ofFile: "device.json"), .device)
        XCTAssertEqual(SyncFormat.kind(ofFile: "reviews-2026-11.jsonl"), .reviews(month: "2026-11"))
        XCTAssertNil(SyncFormat.kind(ofFile: "reviews-2026-13.jsonl"))
        XCTAssertNil(SyncFormat.kind(ofFile: "cards (1).jsonl"))
        XCTAssertEqual(SyncFormat.path(device: device, file: "cards.jsonl"), "devices/\(device)/cards.jsonl")
    }

    func testTagNormalization() {
        XCTAssertEqual(Tags.normalize("  IA\u{00A0}\u{00A0}& agents \n"), "IA & agents")
        XCTAssertEqual(Tags.key(" Swift  UI "), "swift ui")
        XCTAssertEqual(Tags.normalize("e\u{0301}"), "é")
        XCTAssertNotNil(Tags.error(String(repeating: "a", count: 41)))
        XCTAssertNotNil(Tags.error("a\u{0007}"))
        XCTAssertNil(Tags.error("IA & agents"))
    }

    /// Lignes écrites par l'export de la PWA (tools/export/lib.test.ts) : lues telles quelles par l'app.
    func testReadsLinesWrittenByThePWAExport() {
        let cards = Data(("{\"at\":\"2026-11-25T13:16:29.123Z\",\"back\":\"R\",\"created_at\":\"2026-10-12T08:00:00.000Z\",\"deck\":null,"
            + "\"deleted_at\":\"2026-11-26T00:00:00.000Z\",\"front\":\"Q / é\",\"id\":\"c1\",\"source\":\"manual\",\"source_path\":null,"
            + "\"source_title\":null,\"status\":\"active\",\"tags\":[\"IA\"],\"v\":1}\n").utf8)
        let read = Journal.readCards(cards, device: device)
        XCTAssertEqual(read.errors, [])
        XCTAssertEqual(read.items.first?.at, ISOTimestamp.parse("2026-11-25T13:16:29.123Z"))
        XCTAssertEqual(read.items.first?.card, Card(id: "c1", source: .manual, front: "Q / é", back: "R", tags: ["IA"],
                                                    deletedAt: ISOTimestamp.parse("2026-11-26T00:00:00.000Z"),
                                                    createdAt: ISOTimestamp.parse("2026-10-12T08:00:00.000Z")))
        let reviews = Data("{\"card_id\":\"c1\",\"free\":false,\"id\":\"r1\",\"rating\":2,\"reviewed_at\":\"2026-11-25T13:16:29.123Z\",\"v\":1}\n".utf8)
        XCTAssertEqual(Journal.readReviews(reviews).items,
                       [Review(id: "r1", cardId: "c1", rating: .hard, reviewedAt: ISOTimestamp.parse("2026-11-25T13:16:29.123Z")!)])
    }
}
