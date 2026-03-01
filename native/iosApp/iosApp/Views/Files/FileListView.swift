import SwiftUI
import shared

struct FileListView: View {
    @StateObject private var viewModel = FileListViewModelWrapper()

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            header

            if viewModel.isLoading {
                LoadingView()
            } else if let errorMessage = viewModel.errorMessage {
                ErrorView(message: errorMessage) {
                    viewModel.refresh()
                }
            } else if viewModel.files.isEmpty {
                EmptyView_(message: "파일이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: AppTheme.Spacing.sm) {
                        ForEach(viewModel.files, id: \.id) { file in
                            Button(action: { }) {
                                HStack(spacing: AppTheme.Spacing.md) {
                                    Image(systemName: fileIcon(mimeType: file.mimeType))
                                        .foregroundColor(.appPrimary)
                                        .font(.appHeading4)

                                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                        Text(file.name)
                                            .font(.appBody)
                                            .foregroundColor(.appForeground)
                                            .lineLimit(2)

                                        if let mime = file.mimeType, !mime.isEmpty {
                                            Text(mime)
                                                .font(.appCaption)
                                                .foregroundColor(.appMutedForeground)
                                        }

                                        if let createdAt = file.createdAt, !createdAt.isEmpty {
                                            Text(createdAt)
                                                .font(.appCaption)
                                                .foregroundColor(.appMutedForeground)
                                        }
                                    }

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .font(.appCaption)
                                        .foregroundColor(.appMutedForeground)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(AppTheme.Spacing.lg)
                                .background(Color.appCard)
                                .overlay(
                                    RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                                        .stroke(Color.appBorder, lineWidth: 1)
                                )
                                .cornerRadius(AppTheme.Radius.lg)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("file-item-\(file.id)")
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadFiles()
        }
        .accessibilityIdentifier("file-list-screen")
    }

    private var header: some View {
        HStack {
            Text("파일 관리")
                .font(.appHeading2)
                .foregroundColor(.appForeground)
                .accessibilityIdentifier("file-list-title")

            Spacer()

            Button(action: { viewModel.refresh() }) {
                Image(systemName: "arrow.clockwise")
                    .font(.appHeading6)
                    .foregroundColor(.appSecondaryForeground)
                    .frame(width: 36, height: 36)
                    .background(Color.appSecondary)
                    .cornerRadius(AppTheme.Radius.md)
            }
            .accessibilityIdentifier("file-list-refresh")
        }
    }

    private func fileIcon(mimeType: String?) -> String {
        guard let mimeType else {
            return "doc.fill"
        }

        if mimeType.contains("pdf") {
            return "doc.richtext.fill"
        }
        if mimeType.contains("image") {
            return "photo.fill"
        }
        if mimeType.contains("audio") {
            return "waveform"
        }
        if mimeType.contains("video") {
            return "film.fill"
        }
        return "doc.fill"
    }
}

@MainActor
final class FileListViewModelWrapper: ObservableObject {
    private let viewModel: FileListViewModel
    private var observeTask: Task<Void, Never>?

    @Published var isLoading: Bool = true
    @Published var files: [FileItem] = []
    @Published var errorMessage: String?

    init(viewModel: FileListViewModel = KoinHelper.shared.fileListViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        observeTask?.cancel()
    }

    private func observeUiState() {
        observeTask = Task {
            for await state in viewModel.uiState {
                if Task.isCancelled {
                    break
                }

                self.isLoading = state.isLoading
                self.files = state.files
                self.errorMessage = state.error
            }
        }
    }

    func loadFiles() {
        viewModel.loadFiles()
    }

    func refresh() {
        viewModel.refresh()
    }
}
