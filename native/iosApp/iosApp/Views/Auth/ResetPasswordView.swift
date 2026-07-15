import SwiftUI

struct ResetPasswordView: View {
    @StateObject private var viewModel = AuthViewModelWrapper()
    let token: String
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var passwordError: String?
    @State private var confirmPasswordError: String?
    @State private var passwordVisible = false
    @State private var resetSuccess = false

    var onNavigateToLogin: () -> Void = {}

    private var hasMinLength: Bool { password.count >= 8 }
    private var hasUpperCase: Bool { password.rangeOfCharacter(from: .uppercaseLetters) != nil }
    private var hasLowerCase: Bool { password.rangeOfCharacter(from: .lowercaseLetters) != nil }
    private var hasDigit: Bool { password.rangeOfCharacter(from: .decimalDigits) != nil }

    var body: some View {
        VStack(spacing: 16) {
            if resetSuccess {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(.appPrimary)

                Text("비밀번호 변경 완료!")
                    .font(.appHeading2)
                    .fontWeight(.bold)

                Text("새 비밀번호로 로그인해 주세요.")
                    .font(.appBody)
                    .foregroundColor(.appMuted)

                Button(action: onNavigateToLogin) {
                    Text("로그인 페이지로 이동")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
            } else {
                Text("비밀번호 재설정")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("auth-reset-password-title")

                Text("새로운 비밀번호를 입력해 주세요.")
                    .font(.appBody)
                    .foregroundColor(.appMuted)

                if let error = viewModel.errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.appDestructive)
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appDestructive.opacity(0.1))
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                }

                AuthSecureField(
                    label: "새 비밀번호",
                    text: $password,
                    error: $passwordError,
                    visible: $passwordVisible,
                    identifier: "auth-reset-password-field"
                )

                if !password.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        PasswordReqRow(text: "8자 이상", met: hasMinLength)
                        PasswordReqRow(text: "대문자 포함", met: hasUpperCase)
                        PasswordReqRow(text: "소문자 포함", met: hasLowerCase)
                        PasswordReqRow(text: "숫자 포함", met: hasDigit)
                    }
                    .padding(.leading, 4)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("비밀번호 확인").font(.appLabel).foregroundColor(.appForeground)
                    SecureField("비밀번호를 다시 입력하세요", text: $confirmPassword)
                        .padding(12)
                        .background(Color.appBackground)
                        .cornerRadius(CGFloat(AppTheme.Radius.md))
                        .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(confirmPasswordError != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
                        .accessibilityIdentifier("auth-reset-password-confirm-field")
                    if let error = confirmPasswordError {
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                }

                Button(action: validateAndSubmit) {
                    HStack {
                        if viewModel.isLoading { ProgressView().tint(.white) }
                        else { Text("비밀번호 변경").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-reset-password-submit-button")
            }
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
    }

    private func validateAndSubmit() {
        passwordError = nil; confirmPasswordError = nil
        if password.count < 8 { passwordError = "비밀번호는 8자 이상이어야 합니다"; return }
        if !hasUpperCase { passwordError = "대문자를 포함해야 합니다"; return }
        if !hasLowerCase { passwordError = "소문자를 포함해야 합니다"; return }
        if !hasDigit { passwordError = "숫자를 포함해야 합니다"; return }
        if password != confirmPassword { confirmPasswordError = "비밀번호가 일치하지 않습니다"; return }
        viewModel.resetPassword(token: token, password: password)
        resetSuccess = true
    }
}
