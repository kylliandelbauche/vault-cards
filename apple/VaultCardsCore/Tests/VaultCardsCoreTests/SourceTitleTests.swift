import XCTest
@testable import VaultCardsCore

/// Mêmes cas que tools/cards/title.test.ts (shared/source-title.ts).
final class SourceTitleTests: XCTestCase {
    func testSameCasesAsThePWA() {
        XCTAssertEqual(SourceTitle.fromFileName("claude-code-hooks-synthese.md"), "Claude code hooks")
        XCTAssertEqual(SourceTitle.fromFileName("3-Resources/veille/ia/x/prompt-caching-synthese.md"), "Prompt caching")
        XCTAssertEqual(SourceTitle.fromFileName("notes-du-jour.md"), "Notes du jour")
        XCTAssertEqual(SourceTitle.fromFileName("🛡️ x-synthese.md"), "X")
        XCTAssertEqual(SourceTitle.fromFileName("éthique-des-agents-synthese.md"), "Éthique des agents")
        XCTAssertEqual(SourceTitle.fromFileName("a--b-synthese.md"), "A b")
        XCTAssertEqual(SourceTitle.fromFileName("-synthese.md"), "-synthese.md")
        XCTAssertEqual(SourceTitle.humanize("⏳ vivre_maintenant"), "Vivre maintenant")
        XCTAssertEqual(SourceTitle.humanize("🗄️ supabase_vs_convex"), "Supabase vs convex")
        XCTAssertEqual(SourceTitle.humanize("⛏️ minecraft_entre_amis"), "Minecraft entre amis")
        XCTAssertEqual(SourceTitle.humanize("🏗️ developper_avec_ia"), "Developper avec ia")
        XCTAssertEqual(SourceTitle.humanize("👩‍💻 code_propre"), "Code propre")
        XCTAssertEqual(SourceTitle.humanize("👍🏽 ok"), "Ok")
        XCTAssertEqual(SourceTitle.humanize("🇫🇷 histoire"), "Histoire")
        XCTAssertEqual(SourceTitle.humanize("🧠🤖 deux_emojis"), "Deux emojis")
        XCTAssertEqual(SourceTitle.humanize("🏗️ Développeurs : 10 règles"), "Développeurs : 10 règles")
        XCTAssertEqual(SourceTitle.humanize("Variable my_var en Python"), "Variable my_var en Python")
        XCTAssertEqual(SourceTitle.humanize("éthique_des_agents"), "Éthique des agents")
        XCTAssertEqual(SourceTitle.humanize("10_regles"), "10 regles")
        XCTAssertEqual(SourceTitle.humanize("🧠"), "🧠")
        XCTAssertEqual(SourceTitle.humanize("_"), "_")
        XCTAssertEqual(SourceTitle.extract(markdown: "---\ntype: synthese\n---\n# ⏳ vivre_maintenant\n", fileName: "⏳ vivre_maintenant.md"), "Vivre maintenant")
        XCTAssertEqual(SourceTitle.extract(markdown: "texte", fileName: "3-Resources/Second cerveau/⏳ vivre_maintenant.md"), "Vivre maintenant")
        XCTAssertEqual(SourceTitle.extract(markdown: "# Mon titre  \n\ntexte", fileName: "x-synthese.md"), "Mon titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "## Sous\ntexte\n# Le H1\n# Un autre", fileName: "x-synthese.md"), "Le H1")
        XCTAssertEqual(SourceTitle.extract(markdown: "```sh\n# commentaire\n```\n# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "# Titre\r\ntexte", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "#ia\n", fileName: "mon-fichier-synthese.md"), "Mon fichier")
        XCTAssertEqual(SourceTitle.extract(markdown: "juste du texte", fileName: "mon-fichier-synthese.md"), "Mon fichier")
        XCTAssertEqual(SourceTitle.extract(markdown: "#   \ntexte", fileName: "mon-fichier-synthese.md"), "Mon fichier")
        XCTAssertEqual(SourceTitle.extract(markdown: "---\n# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "```\n~~~\n# dans le code\n```\n# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "~~~\n```\n# dans le code\n~~~\n# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "````\n```\n# dans le code\n````\n# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "# Titre ##", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "# Titre #   ", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "# Apprendre C#", fileName: "x-synthese.md"), "Apprendre C#")
        XCTAssertEqual(SourceTitle.extract(markdown: "# ##\n# Suivant", fileName: "x-synthese.md"), "Suivant")
        XCTAssertEqual(SourceTitle.extract(markdown: "\u{FEFF}# Titre", fileName: "x-synthese.md"), "Titre")
        XCTAssertEqual(SourceTitle.extract(markdown: "\u{FEFF}---\na: 1\n---\n# Titre", fileName: "x-synthese.md"), "Titre")
    }

    func testFrontmatterIsSkippedEvenWithAHash() {
        let md = "---\ntitle: autre\n# pas un titre\n---\n\n# Vrai titre\n"
        XCTAssertEqual(SourceTitle.extract(markdown: md, fileName: "x-synthese.md"), "Vrai titre")
    }

    func testLengthIsCappedByCodePoints() {
        let long = SourceTitle.extract(markdown: "# " + String(repeating: "a", count: 300), fileName: "x-synthese.md")
        XCTAssertEqual(long.unicodeScalars.count, SourceTitle.maxLength)
        XCTAssertTrue(long.hasSuffix("…"))
        let emoji = SourceTitle.extract(markdown: "# " + String(repeating: "a", count: 198) + "😀zzz", fileName: "x-synthese.md")
        XCTAssertEqual(emoji, "A" + String(repeating: "a", count: 197) + "😀…")
        let exact = String(repeating: "😀", count: 200)
        XCTAssertEqual(SourceTitle.extract(markdown: "# " + exact, fileName: "x-synthese.md"), exact)
        let file = SourceTitle.extract(markdown: "sans titre", fileName: String(repeating: "b", count: 300) + "-synthese.md")
        XCTAssertEqual(file.unicodeScalars.count, SourceTitle.maxLength)
        XCTAssertEqual(SourceTitle.fromFileName(String(repeating: "c", count: 250) + ".md").unicodeScalars.count, SourceTitle.maxLength)
    }
}
