import XCTest
@testable import VaultCardsCore

/// Règles de « Ajouter des tags » (AddTagsScreen.tsx, src/lib/tags.ts).
final class TagPickerTests: XCTestCase {
    func card(_ id: String, _ tags: [String], status: CardStatus = .active) -> Card {
        Card(id: id, source: .manual, status: status, front: id, back: id, tags: tags)
    }

    func testChoicesCountLiveCardsOncePerCardAZ() {
        let choices = Tags.choices([card("a", ["IA", "ia", "Dev"]), card("b", ["ia"]), card("d", ["Brouillon"], status: .draft)])
        XCTAssertEqual(choices, [TagChoice(name: "Dev", cards: 1), TagChoice(name: "IA", cards: 2)])
    }

    func testIndexLetter() {
        XCTAssertEqual(Tags.indexLetter("écologie"), "E")
        XCTAssertEqual(Tags.indexLetter("swift"), "S")
        XCTAssertEqual(Tags.indexLetter("3D"), "#")
    }

    func testToggleAddsRemovesAndStopsAtFive() {
        var s = TagSelection(["a", "b", "c", "d"])
        XCTAssertNil(s.toggle("E"))
        XCTAssertEqual(s.toggle("f"), "5 tags au maximum par carte.")
        XCTAssertNil(s.toggle("e"))
        XCTAssertEqual(s.selected, ["a", "b", "c", "d"])
    }

    func testCreateNormalizesPutsFirstAndRefusesBadNames() {
        var s = TagSelection(["IA"])
        XCTAssertNil(s.create("  Dev   & outils "))
        XCTAssertEqual(s.selected, ["Dev & outils", "IA"])
        XCTAssertEqual(s.create(String(repeating: "x", count: 41))?.hasPrefix("Nom de tag trop long"), true)
        XCTAssertNil(s.create("ia"))
        XCTAssertEqual(s.selected.count, 2)
    }

    func testRowsIncludeNamesNotYetCreatedAndFilter() {
        let s = TagSelection(["Nouveau"])
        let choices = [TagChoice(name: "IA", cards: 3), TagChoice(name: "Cuisine", cards: 1)]
        XCTAssertEqual(s.rows(choices, query: "").map(\.name), ["Cuisine", "IA", "Nouveau"])
        XCTAssertEqual(s.rows(choices, query: "ou").map(\.name), ["Nouveau"])
        XCTAssertTrue(s.canCreate(choices, query: "Swift"))
        XCTAssertFalse(s.canCreate(choices, query: "ia"))
        XCTAssertFalse(s.canCreate(choices, query: "  "))
    }
}
