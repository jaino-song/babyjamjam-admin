import SwiftUI

struct AppSearchBar: View {
    @Binding var query: String
    var placeholder: String = "검색..."

    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundColor(.appMuted)
            TextField(placeholder, text: $query)
                .disableAutocorrection(true)
            if !query.isEmpty {
                Button(action: { query = "" }) {
                    Image(systemName: "xmark.circle.fill").foregroundColor(.appMuted)
                }
            }
        }
        .padding(12)
        .background(Color.appBackground)
        .cornerRadius(CGFloat(AppTheme.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(Color.appBorder, lineWidth: 1))
        .accessibilityIdentifier("search-bar")
    }
}
