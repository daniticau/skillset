import AppKit
import SwiftUI

/// Connections only.
///
/// Skillset does two things — hold the canonical library and build skills — so
/// settings is just the list of agents the library mirrors into.
struct SettingsView: View {
    @Bindable var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeading(
                    "Connections",
                    subtitle: "Every skill in the library is mirrored into each connected agent."
                )

                SoftPanel {
                    VStack(spacing: 0) {
                        ForEach(Array(model.snapshot.connections.enumerated()), id: \.element.id) { index, connection in
                            if index > 0 {
                                Rectangle()
                                    .fill(.primary.opacity(0.06))
                                    .frame(height: 1)
                                    .padding(.vertical, 9)
                            }
                            ConnectionRow(model: model, connection: connection)
                        }
                    }
                }

                SoftPanel {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Canonical library")
                            .font(.system(size: 12.5, weight: .medium))
                        Text(model.snapshot.storePath)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        Text("Every change is committed here, so nothing is lost.")
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .frame(maxWidth: 660, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.top, 28)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.never)
    }
}

private struct ConnectionRow: View {
    @Bindable var model: AppModel
    let connection: Connection

    private var statusColor: Color {
        switch connection.status {
        case .live: .green
        case .attention: .orange
        case .offline: .secondary
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: AgentPresentation.symbol(for: connection.agent))
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(connection.name)
                    .font(.system(size: 12.5, weight: .medium))
                Text(connection.path)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: 8)

            if connection.configured {
                HStack(spacing: 5) {
                    Circle().fill(statusColor).frame(width: 5, height: 5)
                    Text("\(connection.skillCount)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            Button(connection.configured ? "Disconnect" : "Connect") {
                Task { await model.performConnectionAction(connection) }
            }
            .buttonStyle(.plain)
            .font(.system(size: 11))
            .foregroundStyle(connection.configured ? .secondary : Color.accentColor)
            .disabled(model.busyConnectionID == connection.id)
        }
    }
}
