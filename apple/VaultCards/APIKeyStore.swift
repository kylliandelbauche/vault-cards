import Foundation
import Observation
import Security
import VaultCardsCore

/// Clé API Anthropic de l'utilisateur, gardée dans le Keychain de l'appareil (jamais dans un fichier, un log ou le
/// dossier synchronisé). Mot de passe générique du trousseau à protection de données, y compris sur macOS
/// (Apple TN3137), lisible seulement appareil déverrouillé et jamais synchronisé ni restauré sur un autre appareil
/// (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). Keychain Services : SecItemCopyMatching, SecItemUpdate,
/// SecItemAdd, SecItemDelete.
enum APIKeyStore {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "io.github.kylliandelbauche.vaultcards.anthropic",
        kSecAttrAccount as String: "api-key",
        kSecUseDataProtectionKeychain as String: true,
    ]

    static func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Remplace la clé si elle existe, l'ajoute sinon. Rend le statut du Keychain.
    @discardableResult
    static func save(_ key: String) -> OSStatus {
        let data = Data(key.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemUpdate(base as CFDictionary, update as CFDictionary)
        guard status == errSecItemNotFound else { return status }
        var item = base
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        item[kSecAttrLabel as String] = "Vault Cards : clé API Anthropic"
        return SecItemAdd(item as CFDictionary, nil)
    }

    @discardableResult
    static func delete() -> OSStatus {
        SecItemDelete(base as CFDictionary)
    }
}

/// État de la clé partagé entre Réglages et « Générer » : seuls ses 4 derniers caractères sont gardés en mémoire.
@MainActor @Observable
final class AIKeySettings {
    private(set) var hint: String?
    private(set) var checking = false

    var hasKey: Bool { hint != nil }

    init() { refresh() }

    func refresh() {
        hint = APIKeyStore.read().map(APIKey.hint)
    }

    /// Vérifie le format puis la clé auprès d'Anthropic, et l'enregistre si elle n'est pas refusée.
    /// Rend le message à afficher.
    func save(_ input: String) async -> (saved: Bool, message: String) {
        let key: String
        do {
            key = try APIKey.normalized(input)
        } catch {
            return (false, (error as? LocalizedError)?.errorDescription ?? "Clé invalide.")
        }
        checking = true
        defer { checking = false }
        var check = APIKey.Check.unverified
        if let (_, response) = try? await URLSession.shared.data(for: APIKey.checkRequest(apiKey: key)) {
            check = APIKey.check(status: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        if check == .refused {
            return (false, "Anthropic refuse cette clé. Vérifie-la dans ta console Anthropic.")
        }
        let status = APIKeyStore.save(key)
        refresh()
        guard status == errSecSuccess else {
            return (false, "Impossible d'enregistrer la clé dans le trousseau (\(status)).")
        }
        return (true, check == .valid
                ? "Clé vérifiée et enregistrée."
                : "Clé enregistrée, mais pas vérifiée : Anthropic n'a pas répondu.")
    }

    func delete() {
        APIKeyStore.delete()
        refresh()
    }
}
