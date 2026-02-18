import SwiftUI

struct TemplateListView: View {
    @State private var isLoading = true
    @State private var templates: [(id: String, title: String, content: String)] = []

    var onNavigateToNew: () -> Void = {}
    var onNavigateToEdit: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("메시지 템플릿")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("template-list-title")
                Spacer()
                Button(action: onNavigateToNew) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.appPrimary)
                }
                .accessibilityIdentifier("template-list-add")
            }

            if isLoading {
                LoadingView()
            } else if templates.isEmpty {
                EmptyView_(message: "템플릿이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(templates, id: \.id) { template in
                            Button(action: { onNavigateToEdit(template.id) }) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(template.title)
                                        .font(.appBodyLarge)
                                        .fontWeight(.medium)
                                        .foregroundColor(.primary)
                                    Text(template.content)
                                        .font(.appCaption)
                                        .foregroundColor(.appMuted)
                                        .lineLimit(2)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(16)
                                .background(Color(.systemBackground))
                                .cornerRadius(12)
                                .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
                            }
                            .accessibilityIdentifier("template-item-\(template.id)")
                        }
                    }
                }
            }
        }
        .padding(16)
        .accessibilityIdentifier("template-list-screen")
    }
}
