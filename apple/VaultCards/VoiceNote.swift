import AVFoundation
import Foundation
import Observation
import Speech

/// Vocal de la boîte de réception : enregistré dans un fichier temporaire, transcrit en français **sur l'appareil**
/// (`requiresOnDeviceRecognition`), puis effacé. Seul le texte, relu par l'utilisateur, part vers l'IA.
@MainActor @Observable
final class VoiceNote {
    enum Failure: LocalizedError {
        case microphoneDenied, speechDenied, noOnDeviceRecognition, recordingFailed, nothingHeard

        var errorDescription: String? {
            switch self {
            case .microphoneDenied: return "Accès au micro refusé (Réglages > Confidentialité > Micro)."
            case .speechDenied: return "Reconnaissance vocale refusée (Réglages > Confidentialité > Reconnaissance vocale)."
            case .noOnDeviceRecognition:
                return "La transcription du français sur l'appareil n'est pas disponible ici. Utilise la dictée du clavier."
            case .recordingFailed: return "Enregistrement impossible."
            case .nothingHeard: return "Aucune parole reconnue."
            }
        }
    }

    private(set) var recording = false
    private var recorder: AVAudioRecorder?
    private var file: URL?

    func start() async throws {
        guard await AVAudioApplication.requestRecordPermission() else { throw Failure.microphoneDenied }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        #endif
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString).appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        guard recorder.record() else { throw Failure.recordingFailed }
        self.recorder = recorder
        file = url
        recording = true
    }

    /// Arrête l'enregistrement et rend le fichier à transcrire.
    func stop() -> URL? {
        recorder?.stop()
        recorder = nil
        recording = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        defer { file = nil }
        return file
    }

    /// Transcription sur l'appareil ; le fichier audio est effacé dans tous les cas.
    nonisolated static func transcribe(_ url: URL) async throws -> String {
        defer { try? FileManager.default.removeItem(at: url) }
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard status == .authorized else { throw Failure.speechDenied }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR")), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition
        else { throw Failure.noOnDeviceRecognition }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.addsPunctuation = true
        let once = Once()
        let text: String = try await withCheckedThrowingContinuation { continuation in
            recognizer.recognitionTask(with: request) { result, error in
                if let result, result.isFinal {
                    if once.claim() { continuation.resume(returning: result.bestTranscription.formattedString) }
                } else if error != nil {
                    if once.claim() { continuation.resume(throwing: Failure.nothingHeard) }
                }
            }
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw Failure.nothingHeard }
        return trimmed
    }
}

/// Garantit une seule reprise de la continuation (le rappel de reconnaissance peut être appelé plusieurs fois).
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return false }
        done = true
        return true
    }
}
