import SwiftUI

struct TemplateEditView: View {
    let templateId: String
    @StateObject private var viewModel = MessageTemplateViewModelWrapper()
    @State private var title = ""
    @State private var content = ""
    @State private var category = ""
    @State private var titleError: String?
    @State private var contentError: String?
    @State private var showDeleteAlert = false
    @State private var isInitialized = false

    private let variableSuggestions = ["{{고객명}}", "{{직원명}}", "{{예약일시}}", "{{연락처}}"]

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left")
                            .font(.appHeading6)
                            .foregroundColor(.appPrimaryForeground)
                            .frame(width: 36, height: 36)
                            .background(Color.appPrimary)
                            .cornerRadius(AppTheme.Radius.md)
                    }
                    .accessibilityIdentifier("template-edit-back")

                    Text("템플릿 수정")
                        .font(.appHeading2)
                        .foregroundColor(.appForeground)

                    Spacer()

                    Button(action: { showDeleteAlert = true }) {
                        Image(systemName: "trash")
                            .font(.appHeading6)
                            .foregroundColor(.appDestructive)
                    }
                    .accessibilityIdentifier("template-edit-delete")
                }
                .accessibilityIdentifier("template-edit-header")

                if let errorMessage = viewModel.errorMessage {
                    HStack(spacing: AppTheme.Spacing.sm) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.appDestructive)
                        Text(errorMessage)
                            .font(.appBodySmall)
                            .foregroundColor(.appDestructive)
                    }
                    .padding(AppTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appDestructive.opacity(0.12))
                    .cornerRadius(AppTheme.Radius.md)
                    .accessibilityIdentifier("template-edit-error")
                }

                if viewModel.isLoading && !isInitialized {
                    LoadingView()
                }

                VStack(spacing: AppTheme.Spacing.md) {
                    AppFormField(
                        label: "제목 *",
                        text: $title,
                        error: titleError,
                        identifier: "template-edit-title"
                    )

                    VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                        Text("내용 *")
                            .font(.appLabel)
                            .foregroundColor(.appForeground)

                        variableInsertRow

                        TextEditor(text: $content)
                            .font(.appBody)
                            .foregroundColor(.appForeground)
                            .frame(minHeight: 180)
                            .padding(AppTheme.Spacing.sm)
                            .background(Color.appBackground)
                            .overlay(
                                RoundedRectangle(cornerRadius: AppTheme.Radius.md)
                                    .stroke(contentError != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1)
                            )
                            .cornerRadius(AppTheme.Radius.md)
                            .accessibilityIdentifier("template-edit-content")

                        if let contentError {
                            Text(contentError)
                                .font(.appCaption)
                                .foregroundColor(.appDestructive)
                        }
                    }

                    AppFormField(
                        label: "카테고리",
                        text: $category,
                        identifier: "template-edit-category"
                    )
                }
                .padding(AppTheme.Spacing.lg)
                .background(Color.appCard)
                .overlay(
                    RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                        .stroke(Color.appBorder, lineWidth: 1)
                )
                .cornerRadius(AppTheme.Radius.lg)

                Button(action: submit) {
                    if viewModel.isSaving {
                        ProgressView().tint(Color.appPrimaryForeground)
                    } else {
                        Text("저장")
                            .font(.appLabel)
                            .foregroundColor(.appPrimaryForeground)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, AppTheme.Spacing.md)
                .background(isSubmitEnabled ? Color.appPrimary : Color.appMuted)
                .cornerRadius(AppTheme.Radius.md)
                .disabled(!isSubmitEnabled || viewModel.isSaving)
                .accessibilityIdentifier("template-edit-submit")
            }
            .padding(AppTheme.Spacing.lg)
        }
        .alert("삭제 확인", isPresented: $showDeleteAlert) {
            Button("취소", role: .cancel) { }
            Button("삭제", role: .destructive) {
                viewModel.deleteTemplate(id: templateId)
            }
        } message: {
            Text("이 템플릿을 삭제하시겠습니까?")
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadTemplate(id: templateId)
        }
        .onChange(of: viewModel.selectedTemplate?.id) { _, selectedId in
            guard !isInitialized, selectedId == templateId, let template = viewModel.selectedTemplate else {
                return
            }

            title = template.title
            content = template.content
            category = template.category ?? ""
            isInitialized = true
        }
        .onChange(of: viewModel.saveSuccess) { _, saveSuccess in
            if saveSuccess {
                onNavigateBack()
            }
        }
        .onChange(of: viewModel.deleteSuccess) { _, deleteSuccess in
            if deleteSuccess {
                onNavigateBack()
            }
        }
        .accessibilityIdentifier("template-edit-screen")
    }

    private var isSubmitEnabled: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var variableInsertRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AppTheme.Spacing.sm) {
                ForEach(variableSuggestions.indices, id: \.self) { index in
                    let variable = variableSuggestions[index]
                    Button(action: {
                        if !content.isEmpty {
                            content += " "
                        }
                        content += variable
                    }) {
                        Text(variable)
                            .font(.appCaption)
                            .foregroundColor(.appPrimary)
                            .padding(.horizontal, AppTheme.Spacing.sm)
                            .padding(.vertical, AppTheme.Spacing.xs)
                            .background(Color.appPrimary.opacity(0.1))
                            .cornerRadius(AppTheme.Radius.pill)
                    }
                    .accessibilityIdentifier("template-edit-variable-\(index)")
                }
            }
        }
    }

    private func submit() {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)

        titleError = normalizedTitle.isEmpty ? "제목을 입력해 주세요" : nil
        contentError = normalizedContent.isEmpty ? "내용을 입력해 주세요" : nil

        guard titleError == nil, contentError == nil else {
            return
        }

        viewModel.updateTemplate(
            id: templateId,
            title: normalizedTitle,
            content: normalizedContent,
            category: category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : category.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}
