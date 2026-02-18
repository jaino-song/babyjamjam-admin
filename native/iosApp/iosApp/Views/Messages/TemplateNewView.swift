import SwiftUI

struct TemplateNewView: View {
    @State private var title = ""
    @State private var content = ""
    @State private var category = ""
    @State private var isSaving = false

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left")
                            .font(.title3)
                            .foregroundColor(.appPrimary)
                    }
                    Text("템플릿 생성")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                }
                .accessibilityIdentifier("template-new-header")

                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("제목 *").font(.appCaption).foregroundColor(.appMuted)
                        TextField("제목을 입력하세요", text: $title)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("template-new-title")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("내용 *").font(.appCaption).foregroundColor(.appMuted)
                        TextEditor(text: $content)
                            .frame(minHeight: 120)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(.systemGray4)))
                            .accessibilityIdentifier("template-new-content")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("카테고리").font(.appCaption).foregroundColor(.appMuted)
                        TextField("카테고리 (선택)", text: $category)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("template-new-category")
                    }
                }
                .padding(16)
                .background(Color(.systemBackground))
                .cornerRadius(16)
                .shadow(color: .black.opacity(0.05), radius: 4, y: 2)

                Button(action: {
                    guard !title.isEmpty, !content.isEmpty else { return }
                    isSaving = true
                    // TODO: Call ViewModel createTemplate
                }) {
                    if isSaving {
                        ProgressView().tint(.white)
                    } else {
                        Text("저장").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .foregroundColor(.white)
                .background(title.isEmpty || content.isEmpty ? Color.gray : Color.appPrimary)
                .cornerRadius(12)
                .disabled(title.isEmpty || content.isEmpty || isSaving)
                .accessibilityIdentifier("template-new-submit")
            }
            .padding(16)
        }
        .accessibilityIdentifier("template-new-screen")
    }
}
