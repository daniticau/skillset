import CoreServices
import Foundation

/// Calls `onChange` soon after anything in the store changes on disk, so an
/// edit made by an agent or the CLI shows up without a refresh.
///
/// The skills folder is often a symlink into a repo. FSEvents does not follow
/// links, so the watcher also watches the folder the link points at. Writes
/// inside `.git` and the log folder are ignored: every save commits, and that
/// commit must not trigger a second refresh.
final class StoreWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    private let onChange: @MainActor @Sendable () -> Void

    init(storePath: String, onChange: @escaping @MainActor @Sendable () -> Void) {
        self.onChange = onChange
        start(paths: Self.watchedPaths(storePath: storePath))
    }

    deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }

    static func watchedPaths(storePath: String) -> [String] {
        let root = (storePath as NSString).expandingTildeInPath
        let skills = (root as NSString).appendingPathComponent("skills")
        let resolved = (skills as NSString).resolvingSymlinksInPath
        return Array(Set([root, resolved]))
    }

    /// True for a path whose change can alter what the app shows.
    static func matters(_ path: String) -> Bool {
        !path.contains("/.git/") && !path.hasSuffix("/.git") && !path.contains("/logs/")
            && !path.hasSuffix(".DS_Store")
    }

    private func start(paths: [String]) {
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, count, rawPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<StoreWatcher>.fromOpaque(info).takeUnretainedValue()
            let paths = unsafeBitCast(rawPaths, to: NSArray.self) as? [String] ?? []
            guard paths.prefix(count).contains(where: StoreWatcher.matters) else { return }
            // The stream runs on the main queue.
            MainActor.assumeIsolated { watcher.onChange() }
        }
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.4,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
        ) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        self.stream = stream
    }
}
