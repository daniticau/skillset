import AppKit
import SwiftUI

/// The Settings window: how the editor behaves, which agents the library
/// mirrors into, and where the library lives.
struct SettingsView: View {
    @Bindable var model: AppModel
    @AppStorage("editorStylesMarkdown") private var stylesMarkdown = true

    var body: some View {
        Form {
            Section("Editor") {
                Toggle(isOn: $stylesMarkdown) {
                    Text("Style Markdown while editing")
                    Text("Headings, emphasis, lists, and code take their shape as you type.")
                }
            }

            Section("Agents") {
                ForEach(model.snapshot.connections) { connection in
                    ConnectionRow(model: model, connection: connection)
                }
            }

            Section("Library") {
                LabeledContent("Store") {
                    HStack(spacing: 8) {
                        Text(model.snapshot.storePath)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                        Button("Show in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting([
                                URL(fileURLWithPath: (model.snapshot.storePath as NSString).expandingTildeInPath)
                            ])
                        }
                        .buttonStyle(PillButtonStyle())
                    }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 560, height: 620)
    }
}

private struct ConnectionRow: View {
    @Bindable var model: AppModel
    let connection: Connection

    private var busy: Bool { model.busyConnectionID == connection.id }

    private var statusColor: Color {
        switch connection.status {
        case .live: .green
        case .attention: .orange
        case .offline: .secondary
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: AgentPresentation.symbol(for: connection.agent))
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(connection.name)
                    .font(.system(size: 13, weight: .medium))
                Text(connection.path)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: 8)

            if connection.configured {
                HStack(spacing: 5) {
                    Circle().fill(statusColor).frame(width: 6, height: 6)
                    Text("\(connection.skillCount)")
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .help(statusHelp)
            }

            if busy {
                ProgressView().controlSize(.mini)
            } else if !connection.configured {
                Button("Connect") { Task { await model.connect(connection) } }
                    .buttonStyle(PillButtonStyle(tone: .accent))
            } else {
                if connection.status != .live {
                    Button("Repair") { Task { await model.repair(connection) } }
                        .buttonStyle(PillButtonStyle())
                }
                Button("Disconnect") { Task { await model.disconnect(connection) } }
                    .buttonStyle(PillButtonStyle(tone: .destructive))
            }
        }
    }

    private var statusHelp: String {
        switch connection.status {
        case .live: "Every skill is mirrored"
        case .attention: "\(connection.skillCount) of \(connection.expectedSkillCount) skills mirrored"
        case .offline: "The skills folder is missing"
        }
    }
}
