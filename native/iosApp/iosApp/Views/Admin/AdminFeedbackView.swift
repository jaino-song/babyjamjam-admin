import SwiftUI
import shared

struct AdminFeedbackView: View {
    @StateObject private var viewModel = AdminViewModelWrapper()

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Text("관리자 피드백")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("admin-feedback-title")

                Spacer()

                Button(action: { viewModel.loadFeedback() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.appHeading6)
                        .foregroundColor(.appSecondaryForeground)
                        .frame(width: 36, height: 36)
                        .background(Color.appSecondary)
                        .cornerRadius(AppTheme.Radius.md)
                }
                .accessibilityIdentifier("admin-feedback-refresh")
            }

            if viewModel.isLoading {
                LoadingView()
            } else if let errorMessage = viewModel.errorMessage {
                ErrorView(message: errorMessage) {
                    viewModel.loadFeedback()
                }
            } else if viewModel.feedbackItems.isEmpty {
                EmptyView_(message: "피드백이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: AppTheme.Spacing.sm) {
                        ForEach(Array(viewModel.feedbackItems.enumerated()), id: \.offset) { index, item in
                            Text(item)
                                .font(.appBody)
                                .foregroundColor(.appForeground)
                                .padding(AppTheme.Spacing.lg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.appCard)
                                .overlay(
                                    RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                                        .stroke(Color.appBorder, lineWidth: 1)
                                )
                                .cornerRadius(AppTheme.Radius.lg)
                                .accessibilityIdentifier("admin-feedback-item-\(index)")
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadFeedback()
        }
        .accessibilityIdentifier("admin-feedback-screen")
    }
}

@MainActor
final class AdminViewModelWrapper: ObservableObject {
    private let viewModel: AdminViewModel
    private var observeTask: Task<Void, Never>?

    @Published var isLoading: Bool = false
    @Published var feedbackItems: [String] = []
    @Published var errorMessage: String?

    init(viewModel: AdminViewModel = KoinHelper.shared.adminViewModel()) {
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
                self.feedbackItems = state.feedbackItems
                self.errorMessage = state.error
            }
        }
    }

    func loadFeedback() {
        viewModel.loadFeedback()
    }
}
