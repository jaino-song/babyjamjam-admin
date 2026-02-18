package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class LoginRequest(val email: String, val password: String)
@Serializable data class LoginResponse(val accessToken: String, val refreshToken: String, val requiresOrgSelection: Boolean = false)
@Serializable data class RegisterRequest(val name: String, val email: String, val password: String, val phone: String? = null)
@Serializable data class RegisterResponse(val success: Boolean, val message: String? = null, val code: String? = null)
@Serializable data class ForgotPasswordRequest(val email: String)
@Serializable data class ResetPasswordRequest(val token: String, val newPassword: String)
@Serializable data class TokenRefreshRequest(val refreshToken: String)
@Serializable data class TokenRefreshResponse(val accessToken: String, val refreshToken: String)
@Serializable data class VerifyEmailResponse(val success: Boolean, val message: String? = null)
@Serializable data class UserProfile(val id: String, val name: String, val email: String, val role: String, val phone: String? = null, val organizationId: String? = null, val orgRole: String? = null)
@Serializable data class Organization(val id: String, val name: String, val description: String? = null)
