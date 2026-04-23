import Foundation
import Combine
import shared

@MainActor
class AuthViewModelWrapper: ObservableObject {
    private let viewModel: AuthViewModel
    @Published var authState: AuthState = AuthState.Initial()
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil

    init() {
        self.viewModel = KoinHelper.shared.authViewModel()
        observeAuthState()
    }

    private func observeAuthState() {
        // Observe Kotlin StateFlow via a collector
        Task {
            for await state in viewModel.authState {
                self.authState = state
                self.isLoading = state is AuthState.Loading
                if let error = state as? AuthState.Error {
                    self.errorMessage = error.message
                } else {
                    self.errorMessage = nil
                }
            }
        }
    }

    func login(email: String, password: String) {
        viewModel.login(email: email, password: password)
    }

    func register(name: String, email: String, password: String, phone: String?) {
        viewModel.register(name: name, email: email, password: password, phone: phone)
    }

    func logout() {
        viewModel.logout()
    }

    func forgotPassword(email: String) {
        viewModel.forgotPassword(email: email)
    }

    func resetPassword(token: String, password: String) {
        viewModel.resetPassword(token: token, password: password)
    }

    func selectBranch(branchId: String) {
        viewModel.selectBranch(branchId: branchId)
    }

    var isAuthenticated: Bool {
        authState is AuthState.Authenticated
    }

    var requiresBranchSelection: Bool {
        authState is AuthState.RequiresBranchSelection
    }
}
