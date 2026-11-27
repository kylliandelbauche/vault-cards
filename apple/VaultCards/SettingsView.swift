import SwiftUI
import VaultCardsCore

/// Réglages : la clé API Anthropic de l'utilisateur. Mac : fenêtre Réglages (⌘,), comme le veulent les HIG ;
/// iPhone : onglet Réglages.
struct SettingsView: View {
    @Environment(AIKeySettings.self) private var aiKey
    @State private var keyInput = ""
    @State private var replacing = false
    @State private var confirmingDelete = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let hint = aiKey.hint, !replacing {
                        LabeledContent("Clé enregistrée", value: hint)
                        Button("Remplacer la clé") {
                            replacing = true
                            message = nil
                        }
                        Button("Supprimer la clé", role: .destructive) { confirmingDelete = true }
                    } else {
                        SecureField("Clé API Anthropic", text: $keyInput)
                            .textContentType(.password)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                            .onSubmit(save)
                        HStack {
                            Button(aiKey.checking ? "Vérification…" : "Enregistrer la clé", action: save)
                                .disabled(aiKey.checking || keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            if aiKey.checking {
                                Spacer()
                                ProgressView().controlSize(.small)
                            }
                        }
                        if replacing {
                            Button("Annuler") {
                                replacing = false
                                keyInput = ""
                                message = nil
                            }
                        }
                    }
                    if let message {
                        Text(message).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Clé IA")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Elle sert à générer des cartes depuis une note, un texte ou une photo. Elle reste dans le "
                             + "trousseau de cet appareil, n'est jamais écrite dans le dossier de synchro et se saisit "
                             + "sur chaque appareil.")
                        Link("Créer une clé dans la console Anthropic",
                             destination: URL(string: "https://platform.claude.com/settings/keys")!)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Réglages")
            .confirmationDialog("Supprimer la clé de cet appareil ?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Supprimer la clé", role: .destructive) {
                    aiKey.delete()
                    message = nil
                }
            } message: {
                Text("La génération de cartes sera indisponible jusqu'à ce que tu en saisisses une autre.")
            }
        }
        #if os(macOS)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
        #endif
    }

    private func save() {
        guard !aiKey.checking else { return }
        let input = keyInput
        Task {
            let result = await aiKey.save(input)
            message = result.message
            if result.saved {
                keyInput = ""
                replacing = false
            }
        }
    }
}
