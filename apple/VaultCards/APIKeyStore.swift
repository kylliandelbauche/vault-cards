import Foundation
import Security

/// Clé API Anthropic de l'utilisateur, gardée dans le Keychain de l'appareil (jamais dans un fichier, un log ou le
/// dossier synchronisé). Trousseau à protection de données, y compris sur macOS (Apple TN3137), non synchronisé.
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

    static func save(_ key: String) -> Bool {
        delete()
        var item = base
        item[kSecValueData as String] = Data(key.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}
