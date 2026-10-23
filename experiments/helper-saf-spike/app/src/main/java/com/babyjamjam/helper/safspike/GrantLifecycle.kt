package com.babyjamjam.helper.safspike

enum class GrantLifecycleOutcome {
    ACQUIRED,
    ALREADY_SELECTED,
    REPLACED,
    ALREADY_REVOKED,
    RELEASE_FAILED,
    TAKE_FAILED,
}

data class GrantLifecycleResult(
    val outcome: GrantLifecycleOutcome,
    val activeUri: String?,
    val grantStatus: GrantStatus,
    val providerStatus: ProviderStatus,
)

interface GrantLifecycleBackend {
    fun grantStatus(uri: String): GrantStatus

    fun takeReadGrant(uri: String): GrantStatus

    fun releaseReadGrant(uri: String): ProviderStatus
}

/**
 * Owns only the URI currently selected by this diagnostic. A replacement is
 * deliberately release-first: a failed release keeps the old selection and
 * never takes the candidate, so neither grant is orphaned by this flow.
 */
class GrantLifecycleCoordinator(
    private val backend: GrantLifecycleBackend,
    initialSelectedUri: String? = null,
) {
    private var selectedUri: String? = initialSelectedUri

    fun activeUri(): String? = selectedUri

    fun select(candidateUri: String): GrantLifecycleResult {
        val currentUri = selectedUri
        if (currentUri == candidateUri) {
            return when (val status = safeGrantStatus(candidateUri)) {
                GrantStatus.GRANTED -> result(
                    GrantLifecycleOutcome.ALREADY_SELECTED,
                    candidateUri,
                    status,
                    ProviderStatus.OK,
                )

                GrantStatus.MISSING -> {
                    selectedUri = null
                    acquire(candidateUri, replacement = false)
                }

                GrantStatus.NOT_SELECTED, GrantStatus.ERROR -> result(
                    GrantLifecycleOutcome.RELEASE_FAILED,
                    candidateUri,
                    status,
                    ProviderStatus.PROVIDER_ERROR,
                )
            }
        }

        if (currentUri != null) {
            when (val currentStatus = safeGrantStatus(currentUri)) {
                GrantStatus.MISSING -> selectedUri = null
                GrantStatus.GRANTED -> {
                    val releaseStatus = safeRelease(currentUri)
                    val afterRelease = safeGrantStatus(currentUri)
                    if (afterRelease != GrantStatus.MISSING) {
                        return result(
                            GrantLifecycleOutcome.RELEASE_FAILED,
                            currentUri,
                            afterRelease,
                            releaseFailureStatus(releaseStatus),
                        )
                    }
                    selectedUri = null
                }

                GrantStatus.NOT_SELECTED, GrantStatus.ERROR -> return result(
                    GrantLifecycleOutcome.RELEASE_FAILED,
                    currentUri,
                    currentStatus,
                    ProviderStatus.PROVIDER_ERROR,
                )
            }
        }

        return acquire(candidateUri, replacement = currentUri != null)
    }

    fun revoke(): GrantLifecycleResult {
        val currentUri = selectedUri
            ?: return result(
                GrantLifecycleOutcome.ALREADY_REVOKED,
                null,
                GrantStatus.MISSING,
                ProviderStatus.PERMISSION_DENIED,
            )
        val beforeRelease = safeGrantStatus(currentUri)
        if (beforeRelease == GrantStatus.MISSING) {
            selectedUri = null
            return result(
                GrantLifecycleOutcome.ALREADY_REVOKED,
                null,
                GrantStatus.MISSING,
                ProviderStatus.PERMISSION_DENIED,
            )
        }
        if (beforeRelease != GrantStatus.GRANTED) {
            return result(
                GrantLifecycleOutcome.RELEASE_FAILED,
                currentUri,
                beforeRelease,
                ProviderStatus.PROVIDER_ERROR,
            )
        }

        val releaseStatus = safeRelease(currentUri)
        val afterRelease = safeGrantStatus(currentUri)
        if (afterRelease == GrantStatus.MISSING) {
            selectedUri = null
            return result(
                GrantLifecycleOutcome.ALREADY_REVOKED,
                null,
                GrantStatus.MISSING,
                ProviderStatus.PERMISSION_DENIED,
            )
        }
        return result(
            GrantLifecycleOutcome.RELEASE_FAILED,
            currentUri,
            afterRelease,
            releaseFailureStatus(releaseStatus),
        )
    }

    private fun acquire(candidateUri: String, replacement: Boolean): GrantLifecycleResult {
        safeTake(candidateUri)
        val afterTake = safeGrantStatus(candidateUri)
        if (afterTake == GrantStatus.GRANTED) {
            selectedUri = candidateUri
            return result(
                if (replacement) GrantLifecycleOutcome.REPLACED else GrantLifecycleOutcome.ACQUIRED,
                candidateUri,
                afterTake,
                ProviderStatus.OK,
            )
        }
        selectedUri = null
        return result(
            GrantLifecycleOutcome.TAKE_FAILED,
            null,
            afterTake,
            ProviderStatus.PROVIDER_ERROR,
        )
    }

    private fun safeGrantStatus(uri: String): GrantStatus = try {
        backend.grantStatus(uri)
    } catch (_: Exception) {
        GrantStatus.ERROR
    }

    private fun safeTake(uri: String): GrantStatus = try {
        backend.takeReadGrant(uri)
    } catch (_: Exception) {
        GrantStatus.ERROR
    }

    private fun safeRelease(uri: String): ProviderStatus = try {
        backend.releaseReadGrant(uri)
    } catch (_: Exception) {
        ProviderStatus.PROVIDER_ERROR
    }

    private fun releaseFailureStatus(releaseStatus: ProviderStatus): ProviderStatus =
        if (releaseStatus == ProviderStatus.OK) ProviderStatus.PROVIDER_ERROR else releaseStatus

    private fun result(
        outcome: GrantLifecycleOutcome,
        activeUri: String?,
        grantStatus: GrantStatus,
        providerStatus: ProviderStatus,
    ) = GrantLifecycleResult(outcome, activeUri, grantStatus, providerStatus)
}
