import SwiftUI

struct ClientNewView: View {
    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var address = ""
    @State private var memo = ""
    @State private var babyName = ""
    @State private var dueDate = ""
    @State private var nameError: String?
    @State private var isSubmitting = false

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button(action: onNavigateBack) { Image(systemName: "chevron.left").font(.title3) }
                        .accessibilityIdentifier("client-new-back")
                    Text("고객 추가").font(.appHeading2).fontWeight(.bold).accessibilityIdentifier("client-new-title")
                }

                VStack(spacing: 12) {
                    AppFormField(label: "이름 *", text: $name, error: nameError, identifier: "client-new-name")
                    AppFormField(label: "전화번호", text: $phone, keyboardType: .phonePad, identifier: "client-new-phone")
                    AppFormField(label: "이메일", text: $email, keyboardType: .emailAddress, identifier: "client-new-email")
                    AppFormField(label: "주소", text: $address, identifier: "client-new-address")
                    AppFormField(label: "아기 이름", text: $babyName, identifier: "client-new-baby-name")
                    AppFormField(label: "출산 예정일 (YYYY-MM-DD)", text: $dueDate, identifier: "client-new-due-date")
                    AppFormField(label: "메모", text: $memo, identifier: "client-new-memo")
                }
                .padding(16)
                .background(Color.appCard)
                .cornerRadius(CGFloat(AppTheme.Radius.lg))
                .shadow(color: .black.opacity(0.05), radius: 4, y: 2)

                Button(action: {
                    nameError = name.isEmpty ? "이름을 입력해 주세요" : nil
                    guard nameError == nil else { return }
                    isSubmitting = true
                    // TODO: Call ViewModel
                }) {
                    HStack {
                        if isSubmitting { ProgressView().tint(.white) }
                        else { Text("저장").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(isSubmitting)
                .accessibilityIdentifier("client-new-submit")
            }
            .padding(16)
        }
        .accessibilityIdentifier("client-new-screen")
    }
}
