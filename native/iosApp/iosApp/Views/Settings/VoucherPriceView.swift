import SwiftUI

struct VoucherPriceView: View {
    @StateObject private var viewModel = SettingsViewModelWrapper()

    var onNavigateBack: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack(spacing: AppTheme.Spacing.sm) {
                Button(action: onNavigateBack) {
                    Image(systemName: "chevron.left")
                        .font(.appHeading6)
                        .foregroundColor(.appPrimaryForeground)
                        .frame(width: 36, height: 36)
                        .background(Color.appPrimary)
                        .cornerRadius(AppTheme.Radius.md)
                }
                .accessibilityIdentifier("voucher-price-back")

                Text("바우처 가격 관리")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("voucher-price-title")

                Spacer()

                Button(action: { viewModel.refresh() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.appHeading6)
                        .foregroundColor(.appSecondaryForeground)
                        .frame(width: 36, height: 36)
                        .background(Color.appSecondary)
                        .cornerRadius(AppTheme.Radius.md)
                }
                .accessibilityIdentifier("voucher-price-refresh")
            }

            if viewModel.isLoading {
                LoadingView()
            } else if let errorMessage = viewModel.errorMessage {
                ErrorView(message: errorMessage) {
                    viewModel.refresh()
                }
            } else if viewModel.voucherPrices.isEmpty {
                EmptyView_(message: "바우처 가격 정보가 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: AppTheme.Spacing.sm) {
                        ForEach(viewModel.voucherPrices, id: \.id) { voucherPrice in
                            HStack {
                                VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                    Text(voucherPrice.serviceType)
                                        .font(.appBody)
                                        .foregroundColor(.appForeground)
                                }

                                Spacer()

                                Text("\(voucherPrice.price)원")
                                    .font(.appHeading5)
                                    .foregroundColor(.appPrimary)
                            }
                            .padding(AppTheme.Spacing.lg)
                            .background(Color.appCard)
                            .overlay(
                                RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                                    .stroke(Color.appBorder, lineWidth: 1)
                            )
                            .cornerRadius(AppTheme.Radius.lg)
                            .accessibilityIdentifier("voucher-price-item-\(voucherPrice.id)")
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.refresh()
        }
        .accessibilityIdentifier("voucher-price-screen")
    }
}
