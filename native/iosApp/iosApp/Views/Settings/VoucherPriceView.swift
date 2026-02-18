import SwiftUI

struct VoucherPriceView: View {
    @State private var isLoading = true
    @State private var prices: [(name: String, price: Int)] = []

    var onNavigateBack: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button(action: onNavigateBack) {
                    Image(systemName: "chevron.left")
                        .font(.title3)
                        .foregroundColor(.appPrimary)
                }
                Text("바우처 가격 관리")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("voucher-price-title")
            }

            if isLoading {
                LoadingView()
            } else if prices.isEmpty {
                EmptyView_(message: "바우처 가격 정보가 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(prices, id: \.name) { price in
                            HStack {
                                Text(price.name)
                                    .font(.appBodyLarge)
                                    .fontWeight(.medium)
                                Spacer()
                                Text("\(price.price)원")
                                    .font(.appBodyLarge)
                                    .fontWeight(.bold)
                                    .foregroundColor(.appPrimary)
                            }
                            .padding(16)
                            .background(Color(.systemBackground))
                            .cornerRadius(12)
                            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
                            .accessibilityIdentifier("voucher-price-item")
                        }
                    }
                }
            }
        }
        .padding(16)
        .accessibilityIdentifier("voucher-price-screen")
    }
}
