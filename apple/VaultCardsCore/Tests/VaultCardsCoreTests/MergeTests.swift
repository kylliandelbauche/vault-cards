import XCTest
@testable import VaultCardsCore

final class MergeTests: XCTestCase {
    let iphone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    let mac = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

    func ev(_ device: String, _ at: Millis, _ front: String, status: CardStatus = .active, deleted: Millis? = nil) -> CardEvent {
        CardEvent(device: device, at: at, card: Card(id: "c", source: .inbox, status: status, front: front, back: "b",
                                                      tags: ["IA"], deletedAt: deleted))
    }

    func testLastWriteWinsWithDeviceTieBreak() {
        XCTAssertEqual(Merge.cards([ev(mac, 10, "mac"), ev(iphone, 20, "iphone")])["c"]?.front, "iphone")
        XCTAssertEqual(Merge.cards([ev(mac, 20, "mac"), ev(iphone, 20, "iphone")])["c"]?.front, "mac")
        XCTAssertEqual(Merge.cards([ev(iphone, 20, "iphone"), ev(mac, 20, "mac")])["c"]?.front, "mac")
    }

    func testAcceptedCardNeverBecomesDraftAgain() {
        let merged = Merge.cards([ev(iphone, 10, "acceptée", status: .active), ev(mac, 20, "retouche", status: .draft)])
        XCTAssertEqual(merged["c"]?.status, .active)
        XCTAssertEqual(merged["c"]?.front, "retouche")
    }

    func testDeletionWinsWhenLater() {
        XCTAssertEqual(Merge.cards([ev(iphone, 10, "x"), ev(mac, 20, "x", deleted: 20)])["c"]?.deletedAt, 20)
    }

    func testReviewsFromTwoDevicesBothCount() {
        let a = Review(id: "r1", cardId: "c", rating: .good, reviewedAt: 100)
        let b = Review(id: "r2", cardId: "c", rating: .again, reviewedAt: 50)
        let merged = Merge.reviews([a, b, a])
        XCTAssertEqual(merged.map(\.id), ["r2", "r1"])
        XCTAssertEqual(stateFromReviews(merged), stateFromReviews([b, a]))
    }
}
