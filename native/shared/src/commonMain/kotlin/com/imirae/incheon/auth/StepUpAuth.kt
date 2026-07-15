package com.imirae.incheon.auth

enum class SensitiveOperation { VIEW_RECORDINGS, ADMIN_ACTIONS, ACCOUNT_CHANGES, DELETE_DATA }

class StepUpAuth(private val secureStorage: SecureStorage) {
    private val stepUpValidityMs = 5 * 60 * 1000L // 5 minutes
    private val lastStepUpKey = "last_step_up"

    fun requiresStepUp(operation: SensitiveOperation): Boolean {
        val lastStepUp = secureStorage.getString(lastStepUpKey)?.toLongOrNull() ?: return true
        return (currentTimeMillis() - lastStepUp) > stepUpValidityMs
    }

    fun confirmStepUp() {
        secureStorage.putString(lastStepUpKey, currentTimeMillis().toString())
    }

    fun clearStepUp() {
        secureStorage.remove(lastStepUpKey)
    }
}
