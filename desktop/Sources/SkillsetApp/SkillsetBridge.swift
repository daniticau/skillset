import Foundation

enum SkillsetBridgeError: LocalizedError {
    case missingBackend
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingBackend:
            "The bundled Skillset backend could not be found. Rebuild the app with pnpm app:build."
        case .commandFailed(let message):
            message
        }
    }
}

struct SkillsetBridge: Sendable {
    func snapshot() async throws -> DesktopSnapshot {
        let data = try await run(["desktop", "snapshot"])
        return try JSONDecoder().decode(DesktopSnapshot.self, from: data)
    }

    /// The CLI renders the frontmatter, so the app never composes YAML. A
    /// `rename` moves the store folder and every mirror copy in the same pass.
    func saveSkill(name: String, rename: String?, description: String, body: String) async throws {
        var payload: [String: Any] = ["name": name, "description": description, "body": body]
        if let rename, rename != name { payload["rename"] = rename }
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let json = String(data: data, encoding: .utf8) else {
            throw SkillsetBridgeError.commandFailed("Could not encode the skill.")
        }
        _ = try await run(["desktop", "save"], standardInput: json)
    }

    func deleteSkill(name: String) async throws {
        _ = try await run(["remove", name])
    }

    func connect(_ connection: Connection) async throws {
        _ = try await run(["connect", connection.agent, "--path", connection.path])
    }

    func disconnect(_ connection: Connection) async throws {
        _ = try await run(["disconnect", connection.agent, "--path", connection.path])
    }

    func repairConnections() async throws {
        _ = try await run(["doctor", "--repair"])
    }

    /// Turns a skill's always-on flag on or off. The CLI rewrites every
    /// agent's managed instructions block in the same pass.
    func setAlways(name: String, on: Bool) async throws {
        _ = try await run(on ? ["always", name] : ["always", name, "--off"])
    }

    /// Splits a pasted SKILL.md into a name, a description, and a body. The
    /// CLI reads the YAML, so the app never parses frontmatter itself.
    func splitSkill(markdown: String) async throws -> SplitSkill {
        let data = try await run(["desktop", "parse"], standardInput: markdown)
        return try JSONDecoder().decode(SplitSkill.self, from: data)
    }

    /// Adds a new skill from the fields the app edits. The CLI renders the
    /// frontmatter and installs it as `sks add` would.
    func createSkill(name: String, description: String, body: String, always: Bool) async throws {
        let payload: [String: Any] = ["name": name, "description": description, "body": body, "always": always]
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let json = String(data: data, encoding: .utf8) else {
            throw SkillsetBridgeError.commandFailed("Could not encode the skill.")
        }
        _ = try await run(["desktop", "create"], standardInput: json)
    }

    /// Adds a skill from a local folder, `owner/repo`, a GitHub or skills.sh
    /// link, or a tweet that links to one. The CLI resolves the source.
    func addSkill(source: String) async throws {
        _ = try await run(["add", source])
    }

    private func run(_ arguments: [String], standardInput: String? = nil) async throws -> Data {
        let launch = try resolveLaunch()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let result = try Self.execute(launch: launch, arguments: arguments, standardInput: standardInput)
                    continuation.resume(returning: result)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Runs the CLI to the end. Both pipes drain at once: a process that fills
    /// one pipe while the other is read would otherwise block forever.
    private static func execute(launch: (node: URL, cli: URL), arguments: [String], standardInput: String?) throws -> Data {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = launch.node
        process.arguments = [launch.cli.path] + arguments
        process.standardOutput = output
        process.standardError = errors
        process.environment = ProcessInfo.processInfo.environment
        let input = standardInput.map { _ in Pipe() }
        if let input { process.standardInput = input }

        try process.run()

        let errorBuffer = PipeBuffer()
        let drained = DispatchGroup()
        drained.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            errorBuffer.data = errors.fileHandleForReading.readDataToEndOfFile()
            drained.leave()
        }
        if let input, let standardInput {
            input.fileHandleForWriting.write(Data(standardInput.utf8))
            try? input.fileHandleForWriting.close()
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        drained.wait()
        process.waitUntilExit()
        let errorData = errorBuffer.data

        guard process.terminationStatus == 0 else {
            let message = String(data: errorData.isEmpty ? data : errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw SkillsetBridgeError.commandFailed(
                message.flatMap { $0.isEmpty ? nil : Self.plain($0) } ?? "Skillset command failed."
            )
        }
        return data
    }

    /// The CLI colours its messages for a terminal. An alert shows them raw.
    private static func plain(_ message: String) -> String {
        message.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
    }

    private func resolveLaunch() throws -> (node: URL, cli: URL) {
        let files = FileManager.default
        if let bundledCLI = Bundle.main.url(forResource: "skillset-cli", withExtension: "cjs"),
           let nodeFile = Bundle.main.url(forResource: "node-path", withExtension: "txt"),
           let rawNode = try? String(contentsOf: nodeFile, encoding: .utf8),
           files.isExecutableFile(atPath: rawNode.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return (
                URL(fileURLWithPath: rawNode.trimmingCharacters(in: .whitespacesAndNewlines)),
                bundledCLI
            )
        }

        let source = URL(fileURLWithPath: #filePath)
        let repo = source
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let developmentCLI = repo.appending(path: "dist/cli.js")
        for node in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
            if files.isExecutableFile(atPath: node), files.fileExists(atPath: developmentCLI.path) {
                return (URL(fileURLWithPath: node), developmentCLI)
            }
        }
        throw SkillsetBridgeError.missingBackend
    }
}

/// Holds what the stderr reader collected. The group wait orders the write
/// before the read, so no lock is needed.
private final class PipeBuffer: @unchecked Sendable {
    var data = Data()
}
