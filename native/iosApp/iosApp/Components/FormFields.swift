import SwiftUI

struct AppFormField: View {
    let label: String
    @Binding var text: String
    var error: String? = nil
    var keyboardType: UIKeyboardType = .default
    var identifier: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.appLabel).foregroundColor(.appForeground)
            TextField(label, text: $text)
                .keyboardType(keyboardType)
                .padding(12)
                .background(Color.appBackground)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(error != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
                .accessibilityIdentifier(identifier)
            if let error = error {
                Text(error).font(.appCaption).foregroundColor(.appDestructive)
            }
        }
    }
}
