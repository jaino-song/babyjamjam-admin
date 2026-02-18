import SwiftUI

struct LoadingView: View {
    var body: some View {
        VStack { Spacer(); ProgressView().accessibilityIdentifier("loading-indicator"); Spacer() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text(message).font(.appBody).foregroundColor(.appDestructive).accessibilityIdentifier("error-message")
            Button("다시 시도", action: onRetry).buttonStyle(.borderedProminent).tint(.appPrimary).accessibilityIdentifier("retry-button")
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

struct EmptyView_: View {
    let message: String
    var body: some View {
        VStack { Spacer(); Text(message).font(.appBody).foregroundColor(.appMuted).accessibilityIdentifier("empty-message"); Spacer() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
