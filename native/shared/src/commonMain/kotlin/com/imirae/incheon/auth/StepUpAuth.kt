package com.imirae.incheon.auth

enum class SensitiveOperation { VIEW_RECORDINGS, ADMIN_ACTIONS, ACCOUNT_CHANGES, DELETE_DATA }

class StepUpAuth(private val secureStorage: SecureStorage) {
    private val stepUpValidityMs = 5 * 60 * 1000L // 5 minutes
    fun requiresStepUp(operation: SensitiveOperation): Boolean {
        val lastStepUp = secureStorage.getString("last_step_up")?.toLongOrNull() ?: return true
        return (currentTimeMillis() - lastStepUp) > stepUpValidityMs
    }
    fun confirmStepUp() { secureStorage.putString("last_step_up", currentTimeMillis().toString()) }
}
