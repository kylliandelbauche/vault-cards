import XCTest
@testable import VaultCardsCore

final class APIKeyTests: XCTestCase {
    func testNormalizedTrimsPastedKey() throws {
        XCTAssertEqual(try APIKey.normalized("  sk-ant-api03-abcd1234\n"), "sk-ant-api03-abcd1234")
    }

    func testNormalizedRefusesBadKeys() {
        let cases: [(String, APIKey.Invalid)] = [
            (" \n", .empty),
            ("sk-ant-api03 abcd", .spaces),
            ("sk-proj-abcd", .notAnthropic),
            ("sk-ant-" + String(repeating: "a", count: 600), .tooLong),
        ]
        for (input, expected) in cases {
            XCTAssertThrowsError(try APIKey.normalized(input)) { XCTAssertEqual($0 as? APIKey.Invalid, expected) }
        }
    }

    func testHintShowsOnlyTheLastFourCharacters() {
        XCTAssertEqual(APIKey.hint("sk-ant-api03-secretWXYZ"), "…WXYZ")
    }

    func testCheckRequestReadsModelsWithTheKey() {
        let r = APIKey.checkRequest(apiKey: "sk-ant-x")
        XCTAssertEqual(r.httpMethod, "GET")
        XCTAssertEqual(r.url?.host, "api.anthropic.com")
        XCTAssertEqual(r.url?.path, "/v1/models")
        XCTAssertEqual(r.value(forHTTPHeaderField: "x-api-key"), "sk-ant-x")
        XCTAssertEqual(r.value(forHTTPHeaderField: "anthropic-version"), CardGeneration.apiVersion)
        XCTAssertNil(r.httpBody)
    }

    func testCheckStatus() {
        XCTAssertEqual(APIKey.check(status: 200), .valid)
        XCTAssertEqual(APIKey.check(status: 401), .refused)
        XCTAssertEqual(APIKey.check(status: 403), .refused)
        XCTAssertEqual(APIKey.check(status: 529), .unverified)
        XCTAssertEqual(APIKey.check(status: 0), .unverified)
    }
}
