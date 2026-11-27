import Foundation

/// Clé API Anthropic saisie par l'utilisateur dans Réglages : format vérifié sur l'appareil, puis test auprès
/// d'Anthropic (liste des modèles, sans coût) avant de la garder dans le Keychain. La clé n'est jamais écrite ailleurs.
public enum APIKey {
    /// Les clés Anthropic commencent par ce préfixe (`sk-ant-api03-…`).
    public static let prefix = "sk-ant-"
    public static let maxLength = 512
    public static let checkEndpoint = URL(string: "https://api.anthropic.com/v1/models?limit=1")!

    public enum Invalid: Error, Equatable, LocalizedError {
        case empty, spaces, notAnthropic, tooLong

        public var errorDescription: String? {
            switch self {
            case .empty: "Colle ta clé API."
            case .spaces: "La clé ne doit pas contenir d'espace."
            case .notAnthropic: "Ce n'est pas une clé Anthropic : elle commence par « sk-ant- »."
            case .tooLong: "Cette clé est trop longue."
            }
        }
    }

    /// Clé nettoyée (espaces et retours à la ligne autour retirés, fréquents au copier-coller).
    public static func normalized(_ input: String) throws -> String {
        let key = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw Invalid.empty }
        guard !key.contains(where: { $0.isWhitespace }) else { throw Invalid.spaces }
        guard key.hasPrefix(prefix) else { throw Invalid.notAnthropic }
        guard key.count <= maxLength else { throw Invalid.tooLong }
        return key
    }

    /// Ce qui est montré d'une clé enregistrée : ses 4 derniers caractères, jamais plus.
    public static func hint(_ key: String) -> String {
        "…" + key.suffix(4)
    }

    /// Requête de test : lire un modèle ne coûte rien et suffit à savoir si la clé est acceptée.
    public static func checkRequest(apiKey: String) -> URLRequest {
        var r = URLRequest(url: checkEndpoint, timeoutInterval: 20)
        r.httpMethod = "GET"
        r.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        r.setValue(CardGeneration.apiVersion, forHTTPHeaderField: "anthropic-version")
        return r
    }

    public enum Check: Equatable {
        /// Acceptée par Anthropic.
        case valid
        /// Refusée (clé fausse, révoquée ou sans droit) : elle n'est pas enregistrée.
        case refused
        /// Réponse inattendue (surcharge, panne) : enregistrée sans être vérifiée.
        case unverified
    }

    public static func check(status: Int) -> Check {
        switch status {
        case 200..<300: .valid
        case 401, 403: .refused
        default: .unverified
        }
    }
}
