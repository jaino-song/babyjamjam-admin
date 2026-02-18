package com.imirae.incheon.auth

import com.imirae.incheon.data.remote.AuthService
import com.imirae.incheon.network.ApiResult
import com.imirae.incheon.network.TokenProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthManager(
    private val authService: AuthService,
    private val secureStorage: SecureStorage,
) : TokenProvider {
    private val _authState = MutableStateFlow<AuthState>(AuthState.Initial)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override suspend fun getAccessToken(): String? = secureStorage.getString("access_token")
    override suspend fun refreshToken(): String? {
        val rt = secureStorage.getString("refresh_token") ?: return null
        return when (val result = authService.refreshToken(rt)) {
            is ApiResult.Success -> { secureStorage.putString("access_token", result.data.accessToken); secureStorage.putString("refresh_token", result.data.refreshToken); result.data.accessToken }
            is ApiResult.Error -> { logout(); null }
        }
    }

    fun login(email: String, password: String) { scope.launch {
        _authState.value = AuthState.Loading
        when (val result = authService.login(email, password)) {
            is ApiResult.Success -> {
                secureStorage.putString("access_token", result.data.accessToken)
                secureStorage.putString("refresh_token", result.data.refreshToken)
                if (result.data.requiresOrgSelection) _authState.value = AuthState.RequiresOrgSelection
                else loadProfile()
            }
            is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
        }
    }}

    fun register(name: String, email: String, password: String, phone: String?) { scope.launch {
        _authState.value = AuthState.Loading
        when (val result = authService.register(name, email, password, phone)) {
            is ApiResult.Success -> _authState.value = AuthState.Unauthenticated
            is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
        }
    }}

    fun logout() { secureStorage.clear(); _authState.value = AuthState.Unauthenticated }

    fun forgotPassword(email: String) { scope.launch {
        _authState.value = AuthState.Loading
        authService.forgotPassword(email)
        _authState.value = AuthState.Unauthenticated
    }}

    fun resetPassword(token: String, password: String) { scope.launch {
        _authState.value = AuthState.Loading
        when (val result = authService.resetPassword(token, password)) {
            is ApiResult.Success -> _authState.value = AuthState.Unauthenticated
            is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
        }
    }}

    fun selectOrganization(orgId: String) { scope.launch {
        _authState.value = AuthState.Loading
        loadProfile()
    }}

    fun restoreSession() { scope.launch {
        val token = secureStorage.getString("access_token")
        if (token != null) loadProfile() else _authState.value = AuthState.Unauthenticated
    }}

    private suspend fun loadProfile() {
        when (val result = authService.getProfile()) {
            is ApiResult.Success -> _authState.value = AuthState.Authenticated(result.data.id, result.data.role, result.data.organizationId, result.data.orgRole)
            is ApiResult.Error -> { secureStorage.clear(); _authState.value = AuthState.Unauthenticated }
        }
    }
}
