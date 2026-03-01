import SwiftUI

struct EmployeeListView: View {
    @State private var searchQuery = ""
    @State private var statusFilter: String? = nil
    @State private var isLoading = true

    var onNavigateToDetail: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("직원 관리")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("employee-list-title")

            AppSearchBar(query: $searchQuery, placeholder: "직원 검색...")

            FilterChipRow(
                filters: [(nil, "전체"), ("active", "활성"), ("inactive", "비활성")],
                selectedFilter: $statusFilter
            )

            if isLoading {
                LoadingView()
            } else {
                EmptyView_(message: "등록된 직원이 없습니다")
            }
        }
        .padding(16)
        .accessibilityIdentifier("employee-list-screen")
    }
}
