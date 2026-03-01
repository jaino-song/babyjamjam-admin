import SwiftUI

struct ContractListView: View {
    @State private var searchQuery = ""
    @State private var statusFilter: String? = nil
    @State private var isLoading = true

    var onNavigateToDetail: (String) -> Void = { _ in }
    var onNavigateToCreate: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("계약 관리")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("contract-list-title")
                Spacer()
                Button(action: onNavigateToCreate) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.appPrimary)
                }
                .accessibilityIdentifier("contract-list-add-button")
            }

            AppSearchBar(query: $searchQuery, placeholder: "계약 검색...")

            FilterChipRow(
                filters: [(nil, "전체"), ("active", "활성"), ("signed", "서명완료"), ("pending", "대기"), ("draft", "초안"), ("rejected", "거절")],
                selectedFilter: $statusFilter
            )

            if isLoading {
                LoadingView()
            } else {
                EmptyView_(message: "계약이 없습니다")
            }
        }
        .padding(16)
        .accessibilityIdentifier("contract-list-screen")
    }
}
