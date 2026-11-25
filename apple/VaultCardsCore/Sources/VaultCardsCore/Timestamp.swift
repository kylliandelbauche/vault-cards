import Foundation

/// Instant à la milliseconde près, comme un `Date` JavaScript : c'est l'unité des calculs FSRS et du format de fichiers.
public typealias Millis = Int64

public let minuteMillis: Millis = 60_000
public let dayMillis: Millis = 86_400_000

public extension Date {
    init(millis: Millis) { self.init(timeIntervalSince1970: Double(millis) / 1000) }
    /// Millisecondes depuis 1970 (arrondi : un `Date` lu depuis des millisecondes les retrouve exactement).
    var millis: Millis { Millis((timeIntervalSince1970 * 1000).rounded()) }
}

/// Division entière arrondie vers le bas (aussi pour les instants avant 1970).
func floorDiv(_ a: Millis, _ b: Millis) -> Millis {
    let q = a / b
    return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
}

/// Horodatages ISO 8601 UTC `2026-11-25T13:16:29.123Z`, sans `DateFormatter` (déterministe, indépendant de la locale).
public enum ISOTimestamp {
    /// Jours depuis 1970-01-01 pour une date civile (algorithme « days from civil » de H. Hinnant).
    static func days(year: Int64, month: Int64, day: Int64) -> Int64 {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func civil(days z0: Int64) -> (year: Int64, month: Int64, day: Int64) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (month <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, month, day)
    }

    public static func format(_ ms: Millis) -> String {
        let d = floorDiv(ms, dayMillis)
        let rest = ms - d * dayMillis
        let (y, mo, da) = civil(days: d)
        func pad(_ v: Int64, _ n: Int) -> String {
            let s = String(v)
            return String(repeating: "0", count: max(0, n - s.count)) + s
        }
        return "\(pad(y, 4))-\(pad(mo, 2))-\(pad(da, 2))T\(pad(rest / 3_600_000, 2)):\(pad(rest / 60000 % 60, 2))"
            + ":\(pad(rest / 1000 % 60, 2)).\(pad(rest % 1000, 3))Z"
    }

    public static func format(_ date: Date) -> String { format(date.millis) }

    /// Lit `AAAA-MM-JJTHH:MM:SS[.fraction](Z|+00:00)` en UTC ; la fraction est tronquée à la milliseconde. Sinon nil.
    public static func parse(_ text: String) -> Millis? {
        let c = Array(text.utf8)
        func digits(_ from: Int, _ count: Int) -> Int64? {
            guard from + count <= c.count else { return nil }
            var v: Int64 = 0
            for i in from..<(from + count) {
                guard c[i] >= 48, c[i] <= 57 else { return nil }
                v = v * 10 + Int64(c[i] - 48)
            }
            return v
        }
        func at(_ i: Int, _ ch: Character) -> Bool { i < c.count && c[i] == ch.asciiValue! }
        guard let y = digits(0, 4), at(4, "-"), let mo = digits(5, 2), at(7, "-"), let d = digits(8, 2),
              at(10, "T"), let h = digits(11, 2), at(13, ":"), let mi = digits(14, 2), at(16, ":"), let s = digits(17, 2),
              (1...12).contains(mo), (1...31).contains(d), h < 24, mi < 60, s < 60 else { return nil }
        var i = 19
        var ms: Int64 = 0
        if at(i, ".") {
            i += 1
            var n = 0
            while i < c.count, c[i] >= 48, c[i] <= 57 {
                if n < 3 { ms = ms * 10 + Int64(c[i] - 48) }
                n += 1
                i += 1
            }
            guard n > 0 else { return nil }
            for _ in n..<max(n, 3) { ms *= 10 }
        }
        let tail = String(decoding: c[i...], as: UTF8.self)
        guard tail == "Z" || tail == "+00:00" else { return nil }
        let day = days(year: y, month: mo, day: d)
        let back = civil(days: day)
        guard back.year == y, back.month == mo, back.day == d else { return nil } // 31 février, etc.
        return ((day * 24 + h) * 60 + mi) * 60_000 + s * 1000 + ms
    }

    /// Mois UTC `AAAA-MM` d'un instant (nom du fichier de révisions).
    public static func month(_ ms: Millis) -> String { String(format(ms).prefix(7)) }
}
