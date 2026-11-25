import SwiftData
import SwiftUI
import UniformTypeIdentifiers
import VaultCardsCore

/// « Générer » : clé API, choix d'une note Markdown, cartes proposées par l'IA en brouillons à accepter, modifier ou
/// rejeter. Un brouillon n'entre en révision qu'une fois accepté.
struct GenerateView: View {
    @Query(sort: \StoredCard.updatedAt, order: .reverse) private var cards: [StoredCard]
    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @State private var hasKey = APIKeyStore.read() != nil
    @State private var keyInput = ""
    @State private var choosing = false
    @State private var working = false
    @State private var message: String?
    @State private var editing: StoredCard?

    private var drafts: [StoredCard] {
        cards.filter { $0.deletedAt == nil && $0.status == CardStatus.draft.rawValue }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if hasKey {
                        Button(working ? "Génération en cours…" : "Choisir une note") { choosing = true }
                            .disabled(working)
                        Button("Supprimer la clé", role: .destructive) {
                            APIKeyStore.delete()
                            hasKey = false
                        }
                    } else {
                        SecureField("Clé API Anthropic", text: $keyInput)
                        Button("Enregistrer la clé") { saveKey() }
                            .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } footer: {
                    Text(hasKey
                         ? "La note est envoyée à l'IA d'Anthropic avec ta clé. Les cartes proposées arrivent ici en brouillons."
                         : "Ta clé reste dans le trousseau de cet appareil. Elle n'est jamais écrite dans le dossier de synchro.")
                }
                if working {
                    Section { ProgressView("L'IA lit la note…") }
                }
                if let message {
                    Section { Text(message) }
                }
                if !drafts.isEmpty {
                    Section {
                        ForEach(drafts) { draft in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(draft.front).font(.headline)
                                Text(draft.back).foregroundStyle(.secondary)
                                Text(([draft.sourceTitle].compactMap { $0 } + draft.tags).joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    Button("Accepter") { accept(draft) }.buttonStyle(.borderedProminent)
                                    Button("Modifier") { editing = draft }.buttonStyle(.bordered)
                                    Button("Rejeter", role: .destructive) { reject(draft) }.buttonStyle(.bordered)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    } header: {
                        HStack {
                            Text("Brouillons (\(drafts.count))")
                            Spacer()
                            Button("Tout accepter") { drafts.forEach(accept) }.font(.caption)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Générer")
            .fileImporter(isPresented: $choosing, allowedContentTypes: Self.noteTypes) { result in
                if case .success(let url) = result { Task { await generate(from: url) } }
            }
            .sheet(item: $editing) { CardEditor(card: $0) }
        }
    }

    static let noteTypes: [UTType] = [UTType(filenameExtension: "md"), .plainText].compactMap { $0 }

    private func saveKey() {
        let key = keyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if APIKeyStore.save(key) {
            hasKey = true
            keyInput = ""
            message = nil
        } else {
            message = "Impossible d'enregistrer la clé dans le trousseau."
        }
    }

    private func accept(_ draft: StoredCard) {
        draft.status = CardStatus.active.rawValue
        draft.touch()
        try? context.save()
        sync.soon(context)
    }

    private func reject(_ draft: StoredCard) {
        draft.deletedAt = .now
        draft.touch()
        try? context.save()
        sync.soon(context)
    }

    private func generate(from url: URL) async {
        guard let key = APIKeyStore.read() else {
            hasKey = false
            return
        }
        working = true
        message = nil
        defer { working = false }
        let fileName = url.lastPathComponent
        let live = cards.filter { $0.deletedAt == nil }
        var tagKeys = Set<String>()
        let tags = live.filter { $0.status == CardStatus.active.rawValue }.flatMap(\.tags)
            .filter { tagKeys.insert(Tags.key($0)).inserted }.sorted()
        let asked = live.filter { $0.sourcePath == fileName }.map(\.front)
        do {
            let note = try await Task.detached { try Self.readNote(url) }.value
            let title = SourceTitle.extract(markdown: note, fileName: fileName)
            let body = try CardGeneration.requestBody(note: note, title: title, existingTags: tags, existingQuestions: asked)
            let (data, response) = try await URLSession.shared.data(for: CardGeneration.request(apiKey: key, body: body))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let proposals = CardGeneration.clean(try CardGeneration.parse(status: status, body: data), existingQuestions: asked)
            let now = Date.now
            for card in CardGeneration.drafts(proposals, sourcePath: fileName, sourceTitle: title, now: now.millis,
                                              newID: { UUID().uuidString.lowercased() }) {
                context.insert(StoredCard(card, updatedAt: now))
            }
            try context.save()
            sync.soon(context)
            message = proposals.isEmpty
                ? "Rien à retenir dans « \(title) » selon l'IA."
                : "\(proposals.count) brouillon\(proposals.count > 1 ? "s" : "") depuis « \(title) »."
        } catch is URLError {
            message = "Pas de connexion avec l'IA. Réessaie plus tard."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "Génération impossible."
        }
    }

    /// Lecture coordonnée (la note peut être dans iCloud Drive, pas encore téléchargée).
    nonisolated static func readNote(_ url: URL) throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var data: Data?
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordination) { u in
            do { data = try Data(contentsOf: u) } catch { failure = error }
        }
        if let error = coordination ?? failure { throw error }
        guard let data, let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return text
    }
}
