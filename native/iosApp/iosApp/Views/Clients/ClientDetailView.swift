import SwiftUI

struct ClientDetailView: View {
    let clientId: String
    @State private var isLoading = true

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left").font(.title3)
                    }
                    .accessibilityIdentifier("client-detail-back")
                    Text("고객 상세")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                        .accessibilityIdentifier("client-detail-name")
                    Spacer()
                }

                if isLoading {
                    LoadingView()
                } else {
                    // Info card
                    VStack(alignment: .leading, spacing: 12) {
                        Text("기본 정보").font(.appHeading4).fontWeight(.semibold)
                        InfoRow(label: "전화번호", value: "-")
                        InfoRow(label: "이메일", value: "-")
                        InfoRow(label: "주소", value: "-")
                    }
                    .padding(16)
                    .background(Color.appCard)
                    .cornerRadius(CGFloat(AppTheme.Radius.lg))
                    .shadow(color: .black.opacity(0.05), radius: 4, y: 2)

                    // Actions
                    HStack(spacing: 12) {
                        Button(action: {}) {
                            HStack { Image(systemName: "pencil"); Text("수정") }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        .buttonStyle(.bordered)
                        .tint(.appPrimary)
                        .accessibilityIdentifier("client-detail-edit-button")

                        Button(action: {}) {
                            HStack { Image(systemName: "trash"); Text("삭제") }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        .buttonStyle(.bordered)
                        .tint(.appDestructive)
                        .accessibilityIdentifier("client-detail-delete-button")
                    }
                }
            }
            .padding(16)
        }
        .accessibilityIdentifier("client-detail-screen")
    }
}

struct InfoRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).font(.appBodySmall).foregroundColor(.appMuted)
            Spacer()
            Text(value).font(.appBodySmall).fontWeight(.medium)
        }
    }
}
