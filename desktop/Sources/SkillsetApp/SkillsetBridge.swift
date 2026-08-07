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




    func saveSkill(name: String, markdown: String) async throws {
        _ = try await run(["edit", name, "--stdin"], standardInput: markdown)
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

    private func run(_ arguments: [String], standardInput: String? = nil) async throws -> Data {
        let launch = try resolveLaunch()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let output = Pipe()
                let errors = Pipe()
                let input = Pipe()
                process.executableURL = launch.node
                process.arguments = [launch.cli.path] + arguments
                process.standardOutput = output
                process.standardError = errors
                if standardInput != nil {
                    process.standardInput = input
                }
                process.environment = ProcessInfo.processInfo.environment

                do {
                    try process.run()
                    if let standardInput {
                        input.fileHandleForWriting.write(Data(standardInput.utf8))
                        try? input.fileHandleForWriting.close()
                    }
                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    let errorData = errors.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()
                    if process.terminationStatus == 0 {
                        continuation.resume(returning: data)
                    } else {
                        let rawMessage = String(
                            data: errorData.isEmpty ? data : errorData,
                            encoding: .utf8
                        )
                        let message = rawMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
                        continuation.resume(throwing: SkillsetBridgeError.commandFailed(
                            message?.isEmpty == false ? message! : "Skillset command failed."
                        ))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
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

extension SkillsetBridge {
    /// Preview only — `--json` never writes.
    func decompose(idea: String) async throws -> BuilderResponse {
        let data = try await run(["build", "--stdin", "--json"], standardInput: idea)
        return try JSONDecoder().decode(BuilderResponse.self, from: data)
    }

    /// Install exactly the reviewed proposals, without re-running the model.
    func installProposals(_ proposals: [BuilderProposal]) async throws {
        let payload = ["skills": proposals.map(\.installPayload)]
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let json = String(data: data, encoding: .utf8) else {
            throw SkillsetBridgeError.commandFailed("Could not encode the proposal.")
        }
        _ = try await run(["build", "--from-json", "--yes"], standardInput: json)
    }
}
