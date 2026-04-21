import SwiftUI

struct BranchItem: Identifiable {
    let id: String
    let name: String
    let role: String
}

struct SelectBranchView: View {
    @StateObject private var viewModel = AuthViewModelWrapper()
    let branches: [BranchItem]

    var onNavigateToDashboard: () -> Void = {}

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "building.2.fill")
                .font(.system(size: 48))
                .foregroundColor(.appPrimary)

            Text("지점 선택")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("auth-select-branch-title")

            Text("사용할 지점을 선택해 주세요.")
                .font(.appBody)
                .foregroundColor(.appMuted)

            if viewModel.isLoading {
                ProgressView()
            }

            ForEach(branches) { org in
                Button(action: {
                    viewModel.selectBranch(branchId: org.id)
                }) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(org.name)
                                .font(.appBody)
                                .fontWeight(.semibold)
                                .foregroundColor(.appForeground)
                            Text(org.role)
                                .font(.appCaption)
                                .foregroundColor(.appMuted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundColor(.appMuted)
                    }
                    .padding(16)
                    .background(Color.appBackground)
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                }
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-select-branch-item-\(org.id)")
            }
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
        .onChange(of: viewModel.authState) { _, newState in
            if newState is AuthState.Authenticated {
                onNavigateToDashboard()
            }
        }
    }
}
