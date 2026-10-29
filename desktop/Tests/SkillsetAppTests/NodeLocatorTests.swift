import XCTest
@testable import SkillsetApp

final class NodeLocatorTests: XCTestCase {
    func testUsesTheSavedPathWhenItExists() {
        let node = NodeLocator.locate(
            saved: "/Users/builder/.local/bin/node\n",
            home: "/Users/someone",
            isExecutable: { _ in true },
            listDirectory: { _ in [] },
            askShell: { nil }
        )
        XCTAssertEqual(node, "/Users/builder/.local/bin/node")
    }

    func testFallsBackToHomebrewWhenTheSavedPathIsFromAnotherMac() {
        let node = NodeLocator.locate(
            saved: "/Users/builder/.local/bin/node",
            home: "/Users/someone",
            isExecutable: { $0 == "/opt/homebrew/bin/node" },
            listDirectory: { _ in [] },
            askShell: { nil }
        )
        XCTAssertEqual(node, "/opt/homebrew/bin/node")
    }

    func testPicksTheNewestNvmVersion() {
        let node = NodeLocator.locate(
            saved: nil,
            home: "/Users/someone",
            isExecutable: { $0.contains(".nvm") },
            listDirectory: { _ in ["v9.0.0", "v22.3.0", "v20.11.1"] },
            askShell: { nil }
        )
        XCTAssertEqual(node, "/Users/someone/.nvm/versions/node/v22.3.0/bin/node")
    }

    func testAsksTheLoginShellLast() {
        let node = NodeLocator.locate(
            saved: nil,
            home: "/Users/someone",
            isExecutable: { $0 == "/opt/n/bin/node" },
            listDirectory: { _ in [] },
            askShell: { "/opt/n/bin/node" }
        )
        XCTAssertEqual(node, "/opt/n/bin/node")
    }

    func testReturnsNilWithoutNode() {
        let node = NodeLocator.locate(
            saved: nil,
            home: "/Users/someone",
            isExecutable: { _ in false },
            listDirectory: { _ in [] },
            askShell: { nil }
        )
        XCTAssertNil(node)
    }
}
