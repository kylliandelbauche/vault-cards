import SwiftUI
import VaultCardsCore

/// Page « Mes tags » (TagsScreen de la PWA) : « À revoir aujourd'hui » (tags dont la file du jour n'est pas vide,
/// triés comme sur l'accueil, avec leur nombre) puis « À jour ». Un tap lance la session du tag.
struct TagsView: View {
    let tags: [TagCount]
    /// File du jour, toutes les cartes (sous-titre).
    let today: Int
    let study: (String) -> Void

    var body: some View {
        let sorted = Tags.sorted(tags)
        let due = sorted.filter { $0.today > 0 }
        let upToDate = sorted.filter { $0.today == 0 }
        List {
            if tags.isEmpty {
                Text("Aucun tag pour l'instant.").foregroundStyle(.secondary)
            }
            if !due.isEmpty {
                Section("À revoir aujourd'hui") {
                    ForEach(due, id: \.name) { tag in row(tag, badge: "\(tag.today)") }
                }
            }
            if !upToDate.isEmpty {
                Section("À jour") {
                    ForEach(upToDate, id: \.name) { tag in row(tag, badge: nil) }
                }
            }
        }
        .navigationTitle("Mes tags")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text("Mes tags").font(.headline)
                    Text(today > 0 ? "\(today) carte\(today > 1 ? "s" : "") à revoir" : "Tout est à jour")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func row(_ tag: TagCount, badge: String?) -> some View {
        Button { study(tag.name) } label: {
            HStack {
                Text(tag.name)
                Spacer()
                Text("\(tag.total) carte\(tag.total > 1 ? "s" : "")").font(.caption).foregroundStyle(.secondary)
                if let badge {
                    Text(badge).font(.caption.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Color.accentColor, in: Capsule())
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(badge.map { "\(tag.name), \($0) à revoir" } ?? "\(tag.name), à jour")
    }
}
