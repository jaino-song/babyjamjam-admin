import SwiftUI

struct DashboardView: View {
    @State private var isLoading = true
    @State private var totalClients = 0
    @State private var totalEmployees = 0
    @State private var activeContracts = 0
    @State private var pendingContracts = 0

    var onNavigateToClients: () -> Void = {}
    var onNavigateToEmployees: () -> Void = {}
    var onNavigateToContracts: () -> Void = {}
    var onNavigateToClientDetail: (String) -> Void = { _ in }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("대시보드")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("dashboard-title")

                // Stats grid
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    StatCard(title: "고객", value: "\(totalClients)", icon: "person.2.fill", color: .appPrimary, onTap: onNavigateToClients, identifier: "dashboard-stat-clients")
                    StatCard(title: "직원", value: "\(totalEmployees)", icon: "person.badge.shield.checkmark.fill", color: .appSecondary, onTap: onNavigateToEmployees, identifier: "dashboard-stat-employees")
                    StatCard(title: "활성 계약", value: "\(activeContracts)", icon: "doc.text.fill", color: .appSuccess, onTap: onNavigateToContracts, identifier: "dashboard-stat-active-contracts")
                    StatCard(title: "대기 계약", value: "\(pendingContracts)", icon: "clock.fill", color: Color(hex: "F59E0B"), onTap: onNavigateToContracts, identifier: "dashboard-stat-pending-contracts")
                }

                Text("최근 고객")
                    .font(.appHeading4)
                    .fontWeight(.semibold)
                    .padding(.top, 8)

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("최근 고객이 없습니다")
                        .font(.appBody)
                        .foregroundColor(.appMuted)
                }
            }
            .padding(16)
        }
        .accessibilityIdentifier("dashboard-screen")
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    var onTap: () -> Void = {}
    var identifier: String = ""

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(color)
                Text(value)
                    .font(.appHeading3)
                    .fontWeight(.bold)
                    .foregroundColor(.appForeground)
                Text(title)
                    .font(.appCaption)
                    .foregroundColor(.appMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.appCard)
            .cornerRadius(CGFloat(AppTheme.Radius.lg))
            .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}
