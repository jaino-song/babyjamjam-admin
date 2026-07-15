package com.imirae.incheon.network

import kotlin.math.min
import kotlin.random.Random

enum class EndpointCategory {
    AUTH,
    READ_HEAVY,
    MUTATION,
    BACKGROUND_SYNC,
}

data class RateLimitPolicy(
    val maxRetries: Int,
    val baseDelayMillis: Long,
    val maxDelayMillis: Long,
    val jitterRatio: Double = 0.2,
) {
    init {
        require(maxRetries >= 0) { "maxRetries must be >= 0" }
        require(baseDelayMillis > 0) { "baseDelayMillis must be > 0" }
        require(maxDelayMillis >= baseDelayMillis) {
            "maxDelayMillis must be >= baseDelayMillis"
        }
        require(jitterRatio in 0.0..1.0) { "jitterRatio must be between 0.0 and 1.0" }
    }
}

data class RetryPlan(
    val shouldRetry: Boolean,
    val delayMillis: Long,
)

class RateLimitHandler(
    private val policies: Map<EndpointCategory, RateLimitPolicy> = DEFAULT_POLICIES,
    private val random: Random = Random.Default,
) {
    fun shouldRetry(statusCode: Int, attempt: Int, endpointCategory: EndpointCategory): Boolean {
        val policy = policies[endpointCategory] ?: DEFAULT_POLICY
        return statusCode == RATE_LIMIT_STATUS_CODE && attempt in 0 until policy.maxRetries
    }

    fun planRetry(
        statusCode: Int,
        attempt: Int,
        endpointCategory: EndpointCategory,
        retryAfterHeader: String? = null,
    ): RetryPlan {
        if (!shouldRetry(statusCode, attempt, endpointCategory)) {
            return RetryPlan(shouldRetry = false, delayMillis = 0L)
        }

        val policy = policies[endpointCategory] ?: DEFAULT_POLICY
        val calculatedDelay = calculateBackoffDelayMillis(attempt = attempt, policy = policy)
        val retryAfterDelay = parseRetryAfterMillis(retryAfterHeader)
        val delay = if (retryAfterDelay != null) {
            maxOf(calculatedDelay, retryAfterDelay)
        } else {
            calculatedDelay
        }

        return RetryPlan(shouldRetry = true, delayMillis = delay)
    }

    private fun calculateBackoffDelayMillis(attempt: Int, policy: RateLimitPolicy): Long {
        val multiplier = 1L shl attempt.coerceAtMost(MAX_SHIFT_BITS)
        val exponentialDelay = safeMultiply(policy.baseDelayMillis, multiplier)
        val cappedDelay = min(exponentialDelay, policy.maxDelayMillis)

        val jitterCeiling = (cappedDelay * policy.jitterRatio).toLong().coerceAtLeast(1L)
        val jitter = random.nextLong(until = jitterCeiling + 1L)

        return min(cappedDelay + jitter, policy.maxDelayMillis)
    }

    private fun parseRetryAfterMillis(retryAfterHeader: String?): Long? {
        val seconds = retryAfterHeader?.trim()?.toLongOrNull() ?: return null
        if (seconds <= 0L) return null
        return safeMultiply(seconds, MILLIS_IN_SECOND)
    }

    private fun safeMultiply(left: Long, right: Long): Long {
        if (left == 0L || right == 0L) return 0L
        return if (left > Long.MAX_VALUE / right) Long.MAX_VALUE else left * right
    }

    companion object {
        private const val RATE_LIMIT_STATUS_CODE = 429
        private const val MAX_SHIFT_BITS = 16
        private const val MILLIS_IN_SECOND = 1_000L

        private val DEFAULT_POLICY = RateLimitPolicy(
            maxRetries = 3,
            baseDelayMillis = 750L,
            maxDelayMillis = 8_000L,
            jitterRatio = 0.2,
        )

        val DEFAULT_POLICIES: Map<EndpointCategory, RateLimitPolicy> = mapOf(
            EndpointCategory.AUTH to RateLimitPolicy(
                maxRetries = 1,
                baseDelayMillis = 500L,
                maxDelayMillis = 2_000L,
                jitterRatio = 0.1,
            ),
            EndpointCategory.READ_HEAVY to RateLimitPolicy(
                maxRetries = 3,
                baseDelayMillis = 750L,
                maxDelayMillis = 8_000L,
                jitterRatio = 0.2,
            ),
            EndpointCategory.MUTATION to RateLimitPolicy(
                maxRetries = 2,
                baseDelayMillis = 1_000L,
                maxDelayMillis = 10_000L,
                jitterRatio = 0.2,
            ),
            EndpointCategory.BACKGROUND_SYNC to RateLimitPolicy(
                maxRetries = 4,
                baseDelayMillis = 1_500L,
                maxDelayMillis = 20_000L,
                jitterRatio = 0.25,
            ),
        )
    }
}
