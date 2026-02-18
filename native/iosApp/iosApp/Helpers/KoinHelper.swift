import Foundation
import shared

class KoinHelper {
    static let shared = KoinHelper()
    private init() {}

    func authViewModel() -> AuthViewModel {
        return AuthViewModel(authManager: getAuthManager())
    }

    private func getAuthManager() -> AuthManager {
        // In production, this would be resolved from Koin DI
        // For now, create with platform-specific dependencies
        let secureStorage = IosSecureStorage()
        let apiClient = ApiClient(tokenProvider: nil)
        let authService = AuthServiceImpl(apiClient: apiClient)
        return AuthManager(authService: authService, secureStorage: secureStorage)
    }
}
