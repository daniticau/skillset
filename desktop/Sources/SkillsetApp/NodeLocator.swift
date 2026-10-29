import Foundation

/// Finds a Node binary to run the bundled CLI. The build saves the builder's
/// own Node path, which does not exist on another Mac, so the app also looks
/// in the usual install places and then asks the user's login shell.
enum NodeLocator {
    static func locate(
        saved: String?,
        home: String = NSHomeDirectory(),
        isExecutable: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
        listDirectory: (String) -> [String] = { (try? FileManager.default.contentsOfDirectory(atPath: $0)) ?? [] },
        askShell: () -> String? = shellNode
    ) -> String? {
        let found = candidates(saved: saved, home: home, listDirectory: listDirectory).first(where: isExecutable)
        if let found { return found }
        guard let fromShell = askShell(), isExecutable(fromShell) else { return nil }
        return fromShell
    }

    static func candidates(saved: String?, home: String, listDirectory: (String) -> [String]) -> [String] {
        var paths: [String] = []
        if let saved = saved?.trimmingCharacters(in: .whitespacesAndNewlines), !saved.isEmpty {
            paths.append(saved)
        }
        paths += [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "\(home)/.local/bin/node",
            "\(home)/.volta/bin/node",
            "\(home)/.local/share/mise/shims/node",
            "\(home)/.asdf/shims/node",
            "/usr/bin/node",
        ]
        // nvm keeps one folder per version. Try the newest first.
        let nvm = "\(home)/.nvm/versions/node"
        let versions = listDirectory(nvm).sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        paths += versions.map { "\(nvm)/\($0)/bin/node" }
        return paths
    }

    /// Apps opened from Finder get a bare PATH. A login shell loads the user's
    /// profile, so it sees Node wherever they put it.
    private static func shellNode() -> String? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
        process.arguments = ["-l", "-c", "command -v node"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)?
            .split(separator: "\n")
            .last
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }
}
