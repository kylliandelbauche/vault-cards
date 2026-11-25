import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// « Synchro » : dossier choisi (iCloud Drive, Google Drive…), état de la dernière synchro et lignes ignorées.
struct SyncView: View {
    @Environment(SyncService.self) private var sync
    @Environment(\.modelContext) private var context
    @State private var choosing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let name = sync.folderName {
                        LabeledContent("Dossier", value: name)
                    } else {
                        Text("Aucun dossier choisi : les cartes restent sur cet appareil.")
                    }
                    Button(sync.folderName == nil ? "Choisir un dossier" : "Changer de dossier") { choosing = true }
                } footer: {
                    Text("Choisis le même dossier sur chaque appareil, par exemple dans iCloud Drive ou Google Drive. "
                         + "Vault Cards y range ses fichiers dans un sous-dossier VaultCards.")
                }
                if sync.folderName != nil {
                    Section {
                        Button {
                            Task { await sync.sync(context) }
                        } label: {
                            HStack {
                                Text("Synchroniser maintenant")
                                if sync.isSyncing {
                                    Spacer()
                                    ProgressView().controlSize(.small)
                                }
                            }
                        }
                        .disabled(sync.isSyncing)
                        if let last = sync.lastSync {
                            LabeledContent("Dernière synchro", value: last.formatted(date: .abbreviated, time: .shortened))
                        }
                    }
                }
                if sync.needsUpdate {
                    Section {
                        Text("Mettez l'app à jour : une partie du dossier vient d'une version plus récente.")
                            .foregroundStyle(.orange)
                    }
                }
                if let error = sync.error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
                if !sync.problems.isEmpty {
                    Section("Lignes ignorées") {
                        ForEach(Array(sync.problems.enumerated()), id: \.offset) { _, problem in
                            Text(problem).font(.caption)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Synchro")
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result { sync.choose(url, context: context) }
            }
        }
    }
}
