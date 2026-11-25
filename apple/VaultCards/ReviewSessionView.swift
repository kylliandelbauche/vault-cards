import SwiftData
import SwiftUI
import VaultCardsCore

/// Session de révision (ReviewScreen de la PWA) : titre de la source et tags, question, puis réponse, puis une note
/// parmi Je ne sais pas / Moyen / Très bien. Menu ⋯ : modifier ou supprimer la carte. Bilan à la fin.
struct ReviewSessionView: View {
    /// Révision libre (« Réviser à nouveau ») : les notes sont marquées `free`.
    let free: Bool
    /// Session limitée à un tag : titre, et « Réviser à nouveau » reste dans le tag.
    let tag: String?
    /// Session limitée à une liste de cartes (« Étudier ces N cartes ») : « Réviser à nouveau » reste dans la liste.
    let scope: Set<String>?

    @Environment(\.modelContext) private var context
    @Environment(SyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss
    /// File restante : la carte affichée est la première. Une carte notée « Je ne sais pas » revient en fin de file.
    @State private var queue: [SessionItem]
    /// Historique connu (toutes les révisions), complété à chaque note pour recalculer l'état d'une carte remise en file.
    @State private var history: [Review]
    @State private var tally = SessionTally()
    @State private var showBack = false
    @State private var editing: StoredCard?
    @State private var confirmingDelete = false
    @State private var restartedFree: Bool?

    init(items: [SessionItem], reviews: [Review], free: Bool, tag: String? = nil, scope: Set<String>? = nil) {
        self.free = free
        self.tag = tag
        self.scope = scope
        _queue = State(initialValue: items)
        _history = State(initialValue: reviews)
    }

    private var isFree: Bool { restartedFree ?? free }

    var body: some View {
        NavigationStack {
            Group {
                if let item = queue.first {
                    card(item)
                } else {
                    doneView
                }
            }
            .padding()
            .navigationTitle(queue.isEmpty ? "Terminé" : "Reste \(queue.count)")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                if let tag {
                    ToolbarItem(placement: .principal) {
                        Text(queue.isEmpty ? tag : "\(tag) · reste \(queue.count)").font(.headline)
                    }
                }
            }
            .sheet(item: $editing, onDismiss: refreshShown) { CardEditor(card: $0) }
            .confirmationDialog("Supprimer cette carte ?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) { deleteShown() }
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("Elle disparaît de la révision et de « Mes cartes ». Son historique est gardé.")
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
    }

    @ViewBuilder
    private func card(_ item: SessionItem) -> some View {
        VStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(item.card.displayTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Menu {
                        Button { editing = stored(item.card.id) } label: { Label("Modifier", systemImage: "pencil") }
                        Button(role: .destructive) { confirmingDelete = true } label: {
                            Label("Supprimer", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle").imageScale(.large)
                    }
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel("Actions de la carte")
                }
                let tags = item.card.displayTags
                if !tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tags, id: \.self) { t in
                                Text(t).font(.caption).padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(.quaternary, in: Capsule())
                            }
                        }
                    }
                    .accessibilityLabel("Tags : \(tags.joined(separator: ", "))")
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(item.card.front).font(.title3.weight(.semibold))
                    if showBack {
                        Divider()
                        Text(item.card.back)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }
            if showBack {
                let now = Date.now.millis
                let due = previewDue(item.state, now: now)
                HStack(spacing: 12) {
                    ForEach(Rating.allCases, id: \.self) { rating in
                        Button {
                            rate(item, rating)
                        } label: {
                            VStack(spacing: 2) {
                                Text(rating.label).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                                Text(delayLabel(from: now, to: due[rating] ?? now)).font(.caption)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        // Clavier (Mac, iPad) : 1, 2, 3, comme la PWA.
                        .keyboardShortcut(KeyEquivalent(Character(String(rating.rawValue))), modifiers: [])
                        .tint(rating == .again ? .red : rating == .hard ? .orange : .green)
                    }
                }
            } else {
                Button {
                    showBack = true
                } label: {
                    Text("Voir la réponse").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.space, modifiers: [])
            }
        }
    }

    /// Bilan (DoneScreen de la PWA) : notes données, prochaine échéance, réviser à nouveau ou revenir.
    private var doneView: some View {
        let now = Date.now.millis
        let next = nextDue(allCards(), history, now: now, tag: tag)
        return VStack(spacing: 20) {
            Text("Session terminée").font(.title.bold())
            // Aucune note (rien à réviser, cartes supprimées) : pas de bilan « 0 0 0 ».
            if tally.total > 0 {
                HStack(spacing: 24) {
                    Label("\(tally.again)", systemImage: "xmark").foregroundStyle(.red)
                        .accessibilityLabel("\(tally.again) « Je ne sais pas »")
                    Label("\(tally.hard)", systemImage: "minus").foregroundStyle(.orange)
                        .accessibilityLabel("\(tally.hard) « Moyen »")
                    Label("\(tally.good)", systemImage: "checkmark").foregroundStyle(.green)
                        .accessibilityLabel("\(tally.good) « Très bien »")
                }
                .font(.title3.weight(.semibold).monospacedDigit())
            }
            Text(next.map { "Prochaine révision dans \(delayLabel(from: now, to: $0))" } ?? "Aucune carte en attente.")
                .foregroundStyle(.secondary)
            Button("Réviser à nouveau") { restart() }
                .buttonStyle(.borderedProminent)
            Button("Retour à l'accueil") { dismiss() }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func rate(_ item: SessionItem, _ rating: Rating) {
        let review = Review(id: UUID().uuidString.lowercased(), cardId: item.card.id, rating: rating,
                            reviewedAt: Date.now.millis, free: isFree)
        context.insert(StoredReview(review))
        try? context.save()
        history.append(review)
        queue = afterRating(queue, rating: rating, cardHistory: history.filter { $0.cardId == item.card.id })
        tally.add(rating)
        showBack = false
    }

    private func allCards() -> [Card] {
        ((try? context.fetch(FetchDescriptor<StoredCard>())) ?? []).map(\.card)
    }

    private func stored(_ id: String) -> StoredCard? {
        try? context.fetch(FetchDescriptor<StoredCard>(predicate: #Predicate { $0.id == id })).first
    }

    /// Après « Modifier » : la carte affichée reprend son contenu enregistré.
    private func refreshShown() {
        guard let first = queue.first, let card = stored(first.card.id)?.card else { return }
        if card.isLive {
            for i in queue.indices where queue[i].card.id == card.id { queue[i].card = card }
        } else {
            queue.removeAll { $0.card.id == card.id }
        }
    }

    /// Suppression douce (menu ⋯) : la carte sort de la file, son historique reste.
    private func deleteShown() {
        guard let id = queue.first?.card.id, let card = stored(id) else { return }
        card.deletedAt = .now
        card.touch()
        try? context.save()
        sync.soon(context)
        queue.removeAll { $0.card.id == id }
        showBack = false
    }

    /// « Réviser à nouveau » : révision libre du même périmètre (tout, le tag, ou la liste choisie).
    private func restart() {
        let cards = allCards().filter { scope?.contains($0.id) ?? true }
        queue = freeQueue(cards, history, now: Date.now.millis, tag: tag)
        restartedFree = true
        tally = SessionTally()
        showBack = false
    }
}
