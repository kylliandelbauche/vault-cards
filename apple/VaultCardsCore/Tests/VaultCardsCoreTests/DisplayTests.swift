import XCTest
@testable import VaultCardsCore

/// Mêmes cas que src/features/review/CardView.test.tsx (titre et tags) et DoneScreen (bilan).
final class DisplayTests: XCTestCase {
    func card(_ tags: [String], _ title: String?, source: CardSource = .vault) -> Card {
        Card(id: "c", source: source, front: "Q", back: "R", tags: tags, deck: source == .vault ? "mon-deck" : nil,
             sourcePath: source == .vault ? "3-Resources/veille/prompt-caching-synthese.md" : nil, sourceTitle: title)
    }

    func testTitleIsTheSourceTitleNeverThePath() {
        XCTAssertEqual(card(["ia"], "Prompt caching : mesurer le gain").displayTitle, "Prompt caching : mesurer le gain")
    }

    func testMissingTitleFallsBackToTheHumanizedFileName() {
        for t in [nil, "", "   "] { XCTAssertEqual(card(["ia"], t).displayTitle, "Prompt caching") }
    }

    func testManualCardHasANeutralLabel() {
        XCTAssertEqual(card(["ia"], nil, source: .manual).displayTitle, "Carte perso")
    }

    func testTagsAsIsWithoutDuplicatesOrBlanks() {
        XCTAssertEqual(card(["IA & agents", "Sécurité"], nil).displayTags, ["IA & agents", "Sécurité"])
        XCTAssertEqual(card(["IA & agents", "ia & AGENTS"], nil).displayTags, ["IA & agents"])
        XCTAssertEqual(card(["", " ", "Cuisine"], nil).displayTags, ["Cuisine"])
    }

    func testTallyCountsEachRating() {
        var t = SessionTally()
        for r in [Rating.again, .good, .good, .hard] { t.add(r) }
        XCTAssertEqual([t.again, t.hard, t.good, t.total], [1, 1, 2, 4])
    }
}
