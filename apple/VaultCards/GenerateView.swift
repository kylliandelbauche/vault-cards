import PhotosUI
import SwiftData
import SwiftUI
import UniformTypeIdentifiers
import VaultCardsCore

/// « Générer » : clé API, cartes proposées par l'IA depuis une note Markdown ou depuis la boîte de réception (texte
/// saisi ou dicté, photo), en brouillons à accepter, modifier ou rejeter. Un brouillon n'entre en révision qu'une fois
/// accepté.
struct GenerateView: View {
    @Query(sort: \StoredCard.updatedAt, order: .reverse) private var cards: [StoredCard]
    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @State private var hasKey = APIKeyStore.read() != nil
    @State private var keyInput = ""
    @State private var importing = false
    @State private var importKind = Importing.note
    @State private var inboxText = ""
    @State private var photo: Data?
    @State private var photoItem: PhotosPickerItem?
    @State private var voice = VoiceNote()
    @State private var transcribing = false
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
                        Button(working ? "Génération en cours…" : "Choisir une note") { importKind = .note; importing = true }
                            .disabled(working)
                    } else {
                        SecureField("Clé API Anthropic", text: $keyInput)
                        Button("Enregistrer la clé") { saveKey() }
                            .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } header: {
                    Text("Depuis une note")
                } footer: {
                    Text(hasKey
                         ? "La note est envoyée à l'IA d'Anthropic avec ta clé. Les cartes proposées arrivent ici en brouillons."
                         : "Ta clé reste dans le trousseau de cet appareil. Elle n'est jamais écrite dans le dossier de synchro.")
                }
                if hasKey {
                    inboxSection
                    Section {
                        Button("Supprimer la clé", role: .destructive) {
                            APIKeyStore.delete()
                            hasKey = false
                        }
                    }
                }
                if working {
                    Section { ProgressView("L'IA lit le document…") }
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
            .fileImporter(isPresented: $importing,
                          allowedContentTypes: importKind == .image ? [.image] : Self.noteTypes) { result in
                guard case .success(let url) = result else { return }
                switch importKind {
                case .note: Task { await generate(from: url) }
                case .image: Task { await loadImageFile(url) }
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task { await loadPhoto(item) }
            }
            .sheet(item: $editing) { CardEditor(card: $0) }
        }
    }

    static let noteTypes: [UTType] = [UTType(filenameExtension: "md"), .plainText].compactMap { $0 }

    enum Importing { case note, image }

    /// Boîte de réception : un texte (saisi, collé ou dicté) ou une photo.
    @ViewBuilder private var inboxSection: some View {
        Section {
            if photo != nil {
                LabeledContent("Photo jointe", value: "prête")
                Button("Retirer la photo", role: .destructive) { photo = nil }
            } else {
                TextEditor(text: $inboxText)
                    .frame(minHeight: 120)
                HStack {
                    Button(voice.recording ? "Arrêter" : (transcribing ? "Transcription…" : "Dicter")) {
                        Task { await toggleVoice() }
                    }
                    .disabled(transcribing || working)
                    Spacer()
                    PhotosPicker("Photo", selection: $photoItem, matching: .images)
                        .disabled(working || voice.recording)
                    Button("Image…") { importKind = .image; importing = true }
                        .disabled(working || voice.recording)
                }
                .buttonStyle(.bordered)
            }
            Button("Envoyer à l'IA") { Task { await generateInbox() } }
                .disabled(working || voice.recording || transcribing
                          || (photo == nil && inboxText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
        } header: {
            Text("Boîte de réception")
        } footer: {
            Text("Texte ou photo envoyés à l'IA avec ta clé. Le vocal est transcrit sur cet appareil ; seul le texte, "
                 + "que tu peux relire, part vers l'IA.")
        }
    }

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

    private var liveCards: [StoredCard] { cards.filter { $0.deletedAt == nil } }

    private var existingTags: [String] {
        var keys = Set<String>()
        return liveCards.filter { $0.status == CardStatus.active.rawValue }.flatMap(\.tags)
            .filter { keys.insert(Tags.key($0)).inserted }.sorted()
    }

    private func generate(from url: URL) async {
        let fileName = url.lastPathComponent
        let asked = liveCards.filter { $0.sourcePath == fileName }.map(\.front)
        await run(existingQuestions: asked) {
            let note = try await Task.detached { try Self.readNote(url) }.value
            let title = SourceTitle.extract(markdown: note, fileName: fileName)
            return (.note(text: note, title: title), { proposals, now, _ in
                (CardGeneration.drafts(proposals, sourcePath: fileName, sourceTitle: title, now: now,
                                       newID: { UUID().uuidString.lowercased() }), title)
            })
        }
    }

    private func generateInbox() async {
        let input: CardGeneration.Input = photo.map { CardGeneration.Input.image($0, mediaType: "image/jpeg") } ?? .text(inboxText)
        // Pas de note d'origine : aucune question n'est envoyée, les doublons exacts sont écartés ici.
        let ok = await run(existingQuestions: [], dropping: liveCards.map(\.front)) {
            (input, { proposals, now, title in
                (CardGeneration.inboxDrafts(proposals, title: title, now: now, newID: { UUID().uuidString.lowercased() }),
                 CardGeneration.inboxTitle(title))
            })
        }
        if ok {
            inboxText = ""
            photo = nil
        }
    }

    typealias MakeDrafts = ([CardGeneration.Proposal], Millis, String) -> ([Card], String)

    /// Envoie un document à l'IA et range les propositions en brouillons. Rend `true` si la réponse est arrivée.
    @discardableResult
    private func run(existingQuestions: [String], dropping: [String] = [],
                     prepare: () async throws -> (CardGeneration.Input, MakeDrafts)) async -> Bool {
        guard let key = APIKeyStore.read() else {
            hasKey = false
            return false
        }
        working = true
        message = nil
        defer { working = false }
        do {
            let (input, makeDrafts) = try await prepare()
            let body = try CardGeneration.requestBody(input, existingTags: existingTags, existingQuestions: existingQuestions)
            let (data, response) = try await URLSession.shared.data(for: CardGeneration.request(apiKey: key, body: body))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let generated = try CardGeneration.parseGenerated(status: status, body: data)
            let proposals = CardGeneration.clean(generated.cards, existingQuestions: existingQuestions + dropping)
            let now = Date.now
            let (drafts, title) = makeDrafts(proposals, now.millis, generated.title)
            for card in drafts { context.insert(StoredCard(card, updatedAt: now)) }
            try context.save()
            sync.soon(context)
            message = proposals.isEmpty
                ? "Rien à retenir dans « \(title) » selon l'IA."
                : "\(proposals.count) brouillon\(proposals.count > 1 ? "s" : "") depuis « \(title) »."
            return true
        } catch is URLError {
            message = "Pas de connexion avec l'IA. Réessaie plus tard."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "Génération impossible."
        }
        return false
    }

    private func toggleVoice() async {
        message = nil
        do {
            if voice.recording {
                guard let url = voice.stop() else { return }
                transcribing = true
                defer { transcribing = false }
                let text = try await VoiceNote.transcribe(url)
                inboxText = inboxText.isEmpty ? text : inboxText + "\n" + text
            } else {
                try await voice.start()
            }
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "Vocal impossible."
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            message = "Photo illisible."
            return
        }
        await usePhoto(data)
    }

    private func loadImageFile(_ url: URL) async {
        guard let data = try? await Task.detached(operation: { try Self.readData(url) }).value else {
            message = "Image illisible."
            return
        }
        await usePhoto(data)
    }

    private func usePhoto(_ data: Data) async {
        guard let jpeg = await Task.detached(operation: { ImagePrep.jpeg(from: data) }).value else {
            message = "Format d'image non pris en charge."
            return
        }
        message = nil
        photo = jpeg
    }

    /// Lecture coordonnée (la note peut être dans iCloud Drive, pas encore téléchargée).
    nonisolated static func readNote(_ url: URL) throws -> String {
        guard let text = String(data: try readData(url), encoding: .utf8) else {
            throw CocoaError(.fileReadInapplicableStringEncoding)
        }
        return text
    }

    nonisolated static func readData(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var data: Data?
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordination) { u in
            do { data = try Data(contentsOf: u) } catch { failure = error }
        }
        if let error = coordination ?? failure { throw error }
        guard let data else { throw CocoaError(.fileReadUnknown) }
        return data
    }
}
