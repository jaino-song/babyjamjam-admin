import SwiftUI

struct AdminFeedbackView: View {
    @State private var isLoading = false
    @State private var feedbackItems: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("관리자 피드백")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("admin-feedback-title")

            if isLoading {
                LoadingView()
            } else if feedbackItems.isEmpty {
                EmptyView_(message: "피드백이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(feedbackItems, id: \.self) { item in
                            Text(item)
                                .font(.appBody)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.systemBackground))
                                .cornerRadius(12)
                                .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
                        }
                    }
                }
            }
        }
        .padding(16)
        .accessibilityIdentifier("admin-feedback-screen")
    }
}
