package com.imirae.incheon.auth

sealed class AuthState {
    data object Initial : AuthState()
    data object Loading : AuthState()
    data class Authenticated(val userId: String, val role: String, val organizationId: String? = null, val orgRole: String? = null) : AuthState()
    data object RequiresOrgSelection : AuthState()
    data object Unauthenticated : AuthState()
    data class Error(val message: String) : AuthState()
}
