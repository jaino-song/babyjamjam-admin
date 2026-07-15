import SwiftUI

struct FilterChipRow: View {
    let filters: [(value: String?, label: String)]
    @Binding var selectedFilter: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters.indices, id: \.self) { index in
                    let filter = filters[index]
                    Button(action: { selectedFilter = selectedFilter == filter.value ? nil : filter.value }) {
                        Text(filter.label)
                            .font(.appCaption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedFilter == filter.value ? Color.appPrimary : Color.appBackground)
                            .foregroundColor(selectedFilter == filter.value ? .white : .appForeground)
                            .cornerRadius(CGFloat(AppTheme.Radius.pill))
                            .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.pill)).stroke(Color.appBorder, lineWidth: selectedFilter == filter.value ? 0 : 1))
                    }
                    .accessibilityIdentifier("filter-chip-\(filter.value ?? "all")")
                }
            }
        }
    }
}
