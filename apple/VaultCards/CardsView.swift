import SwiftData
import SwiftUI
import VaultCardsCore

/// « Mes cartes » : cartes vivantes, recherche, création, modification et suppression douce.
struct CardsView: View {
    @Query(sort: \StoredCard.updatedAt, order: .reverse) private var cards: [StoredCard]
    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @State private var search = ""
    @State private var editing: Editing?

    enum Editing: Identifiable {
        case new
        case card(StoredCard)
        var id: String {
            switch self {
            case .new: return "new"
            case .card(let c): return c.id
            }
        }
    }

    private var visible: [StoredCard] {
        let live = cards.filter { $0.deletedAt == nil && $0.status != CardStatus.draft.rawValue }
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return live }
        return live.filter {
            $0.front.localizedCaseInsensitiveContains(q) || $0.back.localizedCaseInsensitiveContains(q)
                || $0.tags.contains { Tags.same($0, q) }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(visible) { card in
                    Button {
                        editing = .card(card)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.front).lineLimit(2)
                            Text(card.tags.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("Supprimer", role: .destructive) { delete(card) }
                    }
                    .contextMenu {
                        Button("Supprimer", role: .destructive) { delete(card) }
                    }
                }
            }
            .overlay {
                if visible.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "Aucune carte" : "Aucun résultat", systemImage: "rectangle.stack")
                }
            }
            .searchable(text: $search, prompt: "Rechercher")
            .navigationTitle("Mes cartes")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        editing = .new
                    } label: {
                        Label("Nouvelle carte", systemImage: "plus")
                    }
                }
            }
            .sheet(item: $editing) { e in
                switch e {
                case .new: CardEditor(card: nil)
                case .card(let c): CardEditor(card: c)
                }
            }
        }
    }

    /// Suppression douce : la carte garde son historique de révisions.
    private func delete(_ card: StoredCard) {
        card.deletedAt = .now
        card.touch()
        try? context.save()
        sync.soon(context)
    }
}

struct CardEditor: View {
    let card: StoredCard?

    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss
    @State private var front = ""
    @State private var back = ""
    @State private var tags = ""
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Question") {
                    TextField("Question", text: $front, axis: .vertical).lineLimit(2...6)
                }
                Section("Réponse") {
                    TextField("Réponse", text: $back, axis: .vertical).lineLimit(3...10)
                }
                Section {
                    TextField("IA, Swift", text: $tags)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                } header: {
                    Text("Tags")
                } footer: {
                    Text("Séparés par des virgules, \(Tags.maxPerCard) au plus. Le premier est le principal.")
                }
                if let message {
                    Text(message).foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(card == nil ? "Nouvelle carte" : "Modifier")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                }
            }
            .onAppear {
                guard let card else { return }
                front = card.front
                back = card.back
                tags = card.tags.joined(separator: ", ")
            }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 420)
        #endif
    }

    private func save() {
        let f = front.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = back.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            guard !f.isEmpty else { throw CardDraftError.emptyFront }
            guard !b.isEmpty else { throw CardDraftError.emptyBack }
            let names = try parseTags(tags)
            if let card {
                card.front = f
                card.back = b
                card.tags = names
                card.touch()
            } else {
                let now = Date.now
                context.insert(StoredCard(Card(id: UUID().uuidString.lowercased(), source: .manual, front: f, back: b,
                                               tags: names, createdAt: now.millis), updatedAt: now))
            }
            try context.save()
            sync.soon(context)
            dismiss()
        } catch {
            message = error.localizedDescription
        }
    }
}
