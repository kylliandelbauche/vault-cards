import SwiftData
import SwiftUI
import VaultCardsCore

/// « Ajouter des tags » (AddTagsScreen de la PWA) : recherche, tags de la carte (× retire), liste A–Z des tags avec
/// leur nombre de cartes ; toucher une ligne ajoute ou retire. Aucun tag de ce nom : « Créer « … » » le crée et
/// l'ajoute. Rien n'est enregistré ici : « Valider » rend la liste au formulaire, qui enregistre.
struct TagPickerView: View {
    let initial: [String]
    let onDone: ([String]) -> Void

    @Query private var cards: [StoredCard]
    @Environment(\.dismiss) private var dismiss
    @State private var selection: TagSelection
    @State private var query = ""
    @State private var message: String?
    @State private var confirmingCancel = false

    init(initial: [String], onDone: @escaping ([String]) -> Void) {
        self.initial = initial
        self.onDone = onDone
        _selection = State(initialValue: TagSelection(initial))
    }

    var body: some View {
        let choices = Tags.choices(cards.map(\.card))
        let rows = selection.rows(choices, query: query)
        let sections = Dictionary(grouping: rows, by: { Tags.indexLetter($0.name) })
        let letters = sections.keys.sorted { $0 == "#" ? false : $1 == "#" ? true : $0 < $1 }
        return NavigationStack {
            List {
                Section("Sur cette carte · \(selection.selected.count)") {
                    if selection.selected.isEmpty {
                        Text("Aucun tag pour l'instant.").foregroundStyle(.secondary)
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(selection.selected, id: \.self) { name in
                                    Button { message = selection.toggle(name) } label: {
                                        Label(name, systemImage: "xmark.circle.fill").labelStyle(TrailingIcon())
                                    }
                                    .buttonStyle(.bordered)
                                    .accessibilityLabel("Retirer \(name)")
                                }
                            }
                        }
                    }
                    if let message {
                        Text(message).foregroundStyle(.red)
                    }
                }
                if selection.canCreate(choices, query: query) {
                    Section {
                        Button {
                            create()
                        } label: {
                            Label("Créer « \(Tags.normalize(query)) »", systemImage: "plus")
                        }
                    }
                }
                ForEach(letters, id: \.self) { letter in
                    Section(letter) {
                        ForEach(sections[letter] ?? [], id: \.name) { tag in
                            Button { message = selection.toggle(tag.name) } label: {
                                HStack {
                                    Text(tag.name)
                                    Spacer()
                                    Text("\(tag.cards)").foregroundStyle(.secondary).monospacedDigit()
                                    if selection.contains(tag.name) {
                                        Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selection.contains(tag.name) ? .isSelected : [])
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Rechercher ou créer un tag")
            .onSubmit(of: .search) { if selection.canCreate(choices, query: query) { create() } }
            .onChange(of: query) { message = nil }
            .navigationTitle("Ajouter des tags")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") {
                        if selection.selected == initial { dismiss() } else { confirmingCancel = true }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Valider") {
                        onDone(selection.selected)
                        dismiss()
                    }
                }
            }
            .confirmationDialog("Abandonner les modifications des tags ?", isPresented: $confirmingCancel,
                                titleVisibility: .visible) {
                Button("Abandonner", role: .destructive) { dismiss() }
                Button("Continuer", role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(selection.selected != initial)
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 480)
        #endif
    }

    private func create() {
        message = selection.create(query)
        if message == nil { query = "" }
    }
}

private struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon.foregroundStyle(.secondary)
        }
    }
}
