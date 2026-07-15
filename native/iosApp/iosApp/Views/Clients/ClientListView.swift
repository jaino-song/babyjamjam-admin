import SwiftUI

struct ClientListView: View {
    @State private var searchQuery = ""
    @State private var statusFilter: String? = nil
    @State private var isLoading = true

    var onNavigateToDetail: (String) -> Void = { _ in }
    var onNavigateToNew: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("고객 관리")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("client-list-title")
                Spacer()
                Button(action: onNavigateToNew) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.appPrimary)
                }
                .accessibilityIdentifier("client-list-add-button")
            }

            AppSearchBar(query: $searchQuery, placeholder: "고객 검색...")

            FilterChipRow(
                filters: [(nil, "전체"), ("active", "활성"), ("inactive", "비활성")],
                selectedFilter: $statusFilter
            )

            if isLoading {
                LoadingView()
            } else {
                EmptyView_(message: "등록된 고객이 없습니다")
            }
        }
        .padding(16)
        .accessibilityIdentifier("client-list-screen")
    }
}
