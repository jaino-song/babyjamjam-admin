import SwiftUI

struct TemplateEditView: View {
    let templateId: String
    @State private var title = ""
    @State private var content = ""
    @State private var category = ""
    @State private var isSaving = false
    @State private var showDeleteAlert = false

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
                    Text("템플릿 수정")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                    Spacer()
                    Button(action: { showDeleteAlert = true }) {
                        Image(systemName: "trash")
                            .foregroundColor(.appDestructive)
                    }
                    .accessibilityIdentifier("template-edit-delete")
                }
                .accessibilityIdentifier("template-edit-header")

                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("제목").font(.appCaption).foregroundColor(.appMuted)
                        TextField("제목", text: $title)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("template-edit-title")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("내용").font(.appCaption).foregroundColor(.appMuted)
                        TextEditor(text: $content)
                            .frame(minHeight: 120)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(.systemGray4)))
                            .accessibilityIdentifier("template-edit-content")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("카테고리").font(.appCaption).foregroundColor(.appMuted)
                        TextField("카테고리", text: $category)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("template-edit-category")
                    }
                }
                .padding(16)
                .background(Color(.systemBackground))
                .cornerRadius(16)
                .shadow(color: .black.opacity(0.05), radius: 4, y: 2)

                Button(action: {
                    isSaving = true
                    // TODO: Call ViewModel updateTemplate
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
                .background(Color.appPrimary)
                .cornerRadius(12)
                .disabled(isSaving)
                .accessibilityIdentifier("template-edit-submit")
            }
            .padding(16)
        }
        .alert("삭제 확인", isPresented: $showDeleteAlert) {
            Button("취소", role: .cancel) {}
            Button("삭제", role: .destructive) {
                // TODO: Call ViewModel deleteTemplate
                onNavigateBack()
            }
        } message: {
            Text("이 템플릿을 삭제하시겠습니까?")
        }
        .accessibilityIdentifier("template-edit-screen")
    }
}
