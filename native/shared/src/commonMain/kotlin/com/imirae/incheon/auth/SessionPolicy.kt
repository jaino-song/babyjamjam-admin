package com.imirae.incheon.auth

sealed class SessionAction {
    data object Continue : SessionAction()
    data object ForceReAuth : SessionAction()
    data object RefreshToken : SessionAction()
}

class SessionPolicy(private val secureStorage: SecureStorage) {
    private val idleTimeoutMs = 30 * 60 * 1000L // 30 minutes
    fun checkSession(): SessionAction {
        val lastActivity = secureStorage.getString("last_activity")?.toLongOrNull() ?: return SessionAction.ForceReAuth
        val now = currentTimeMillis()
        return if (now - lastActivity > idleTimeoutMs) SessionAction.ForceReAuth else SessionAction.Continue
    }
    fun updateActivity() { secureStorage.putString("last_activity", currentTimeMillis().toString()) }
}

expect fun currentTimeMillis(): Long
