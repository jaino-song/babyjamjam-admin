import SwiftUI

struct DataListItem<Content: View>: View {
    let onTap: () -> Void
    let identifier: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        Button(action: onTap) {
            HStack {
                content()
            }
            .padding(16)
            .background(Color.appCard)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
            .shadow(color: .black.opacity(0.03), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

struct PaginationControls: View {
    let currentPage: Int
    let totalPages: Int
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack {
            Button("이전", action: onPrevious).disabled(currentPage <= 1)
            Spacer()
            Text("\(currentPage) / \(totalPages)").font(.appBodySmall)
            Spacer()
            Button("다음", action: onNext).disabled(currentPage >= totalPages)
        }
        .padding(.vertical, 8)
    }
}
