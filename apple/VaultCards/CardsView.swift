import SwiftData
import SwiftUI
import VaultCardsCore

/// « Mes cartes » (MyCardsScreen de la PWA) : cartes vivantes, recherche sans accents ni casse, filtre par document
/// importé, « Étudier ces N cartes » quand un filtre est actif, création, modification et suppression douce.
struct CardsView: View {
    @Query(sort: \StoredCard.updatedAt, order: .reverse) private var cards: [StoredCard]
    @Query private var storedReviews: [StoredReview]
    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @State private var search = ""
    @State private var document: String?
    @State private var editing: Editing?
    @State private var studying: Study?

    struct Study: Identifiable {
        let id = UUID()
        let items: [SessionItem]
        let reviews: [Review]
        let scope: Set<String>
    }

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

    private var index: MyCards.Index {
        let updated = Dictionary(cards.map { ($0.id, $0.updatedAt.millis) }, uniquingKeysWith: { a, _ in a })
        return MyCards.index(cards.map(\.card), updatedAt: { updated[$0.id] ?? 0 })
    }

    var body: some View {
        let index = self.index
        let shown = MyCards.filter(index.cards, query: search, document: document)
        let byId = Dictionary(cards.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let filtered = document != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty
        return NavigationStack {
            List {
                if !index.documents.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                chip("Tous", selected: document == nil) { document = nil }
                                ForEach(index.documents, id: \.label) { doc in
                                    chip("\(doc.label) · \(doc.count)", selected: document == doc.label) {
                                        document = document == doc.label ? nil : doc.label
                                    }
                                    .accessibilityLabel("\(doc.label), \(doc.count) carte\(doc.count > 1 ? "s" : "")")
                                }
                            }
                        }
                    }
                }
                ForEach(shown, id: \.card.id) { item in
                    if let card = byId[item.card.id] {
                        Button {
                            editing = .card(card)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(card.front).lineLimit(2)
                                Text(item.card.displayTags.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
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
            }
            .overlay {
                if shown.isEmpty {
                    ContentUnavailableView(filtered ? "Aucun résultat" : "Aucune carte", systemImage: "rectangle.stack")
                }
            }
            .safeAreaInset(edge: .bottom) {
                // Filtre actif (document ou recherche) : révision libre des cartes de la liste (#105 de la PWA).
                if filtered && !shown.isEmpty {
                    Button {
                        let picked = shown.map(\.card)
                        let reviews = storedReviews.compactMap(\.review)
                        studying = Study(items: freeQueue(picked, reviews, now: Date.now.millis), reviews: reviews,
                                         scope: Set(picked.map(\.id)))
                    } label: {
                        Text("Étudier \(shown.count == 1 ? "cette carte" : "ces \(shown.count) cartes")")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                }
            }
            .searchable(text: $search, prompt: "Rechercher dans mes cartes")
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
            .onChange(of: index.documents) { _, docs in
                if let document, !docs.contains(where: { $0.label == document }) { self.document = nil }
            }
            .sheet(item: $studying, onDismiss: { sync.soon(context) }) { s in
                ReviewSessionView(items: s.items, reviews: s.reviews, free: true, scope: s.scope)
            }
            .sheet(item: $editing) { e in
                switch e {
                case .new: CardEditor(card: nil)
                case .card(let c): CardEditor(card: c)
                }
            }
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).lineLimit(1) }
            .buttonStyle(.bordered)
            .tint(selected ? .accentColor : .secondary)
            .accessibilityAddTraits(selected ? .isSelected : [])
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
