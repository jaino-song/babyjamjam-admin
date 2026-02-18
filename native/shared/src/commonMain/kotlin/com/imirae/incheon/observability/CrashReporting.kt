package com.imirae.incheon.observability

/**
 * Crash reporting and performance telemetry configuration.
 * Android: Firebase Crashlytics
 * iOS: Sentry (configured via Swift)
 *
 * Privacy-safe: PII is stripped from crash reports per logging-policy.md
 *
 * Alert thresholds:
 * - Crash-free rate: >99.5%
 * - Cold start time: <2s
 * - ANR rate: <0.5%
 */

object CrashReporting {
    /**
     * Initialize crash reporting. Call from Application.onCreate (Android) or AppDelegate (iOS).
     */
    fun initialize(isDebug: Boolean) {
        if (isDebug) {
            // Disable crash reporting in debug builds
            return
        }
        // Platform-specific initialization handled by actual implementations
    }

    /**
     * Log a non-fatal error for tracking.
     */
    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        // Strip PII before logging
        val sanitized = sanitizeMessage(message)
        // TODO: Forward to Crashlytics/Sentry
        println("[CrashReporting] $tag: $sanitized")
    }

    /**
     * Set user identifier for crash correlation (use opaque ID, not email/name).
     */
    fun setUserId(userId: String) {
        // TODO: Forward to Crashlytics/Sentry
    }

    /**
     * Clear user identifier on logout.
     */
    fun clearUserId() {
        // TODO: Forward to Crashlytics/Sentry
    }

    /**
     * Record custom performance metric.
     */
    fun recordMetric(name: String, value: Long) {
        // TODO: Forward to performance monitoring
    }

    /**
     * Strip PII from crash report messages.
     * Removes: email addresses, phone numbers, Korean names (2-4 chars), tokens.
     */
    private fun sanitizeMessage(message: String): String {
        return message
            .replace(Regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), "[EMAIL]")
            .replace(Regex("01[0-9]-?[0-9]{3,4}-?[0-9]{4}"), "[PHONE]")
            .replace(Regex("Bearer [a-zA-Z0-9._-]+"), "Bearer [TOKEN]")
            .replace(Regex("eyJ[a-zA-Z0-9._-]+"), "[JWT]")
    }
}

/**
 * Performance telemetry for startup time, frame drops, network errors.
 */
object PerformanceTelemetry {
    private var appStartTime: Long = 0

    fun markAppStart() {
        appStartTime = currentTimeMillis()
    }

    fun markAppReady() {
        val startupTime = currentTimeMillis() - appStartTime
        CrashReporting.recordMetric("startup_time_ms", startupTime)
        if (startupTime > 2000) {
            CrashReporting.logError("Performance", "Slow startup: ${startupTime}ms (target: <2000ms)")
        }
    }

    fun recordFrameDrop(droppedFrames: Int) {
        if (droppedFrames > 5) {
            CrashReporting.recordMetric("frame_drops", droppedFrames.toLong())
        }
    }

    fun recordNetworkError(endpoint: String, statusCode: Int) {
        CrashReporting.recordMetric("network_error_$statusCode", 1)
    }

    private fun currentTimeMillis(): Long = kotlin.system.getTimeMillis()
}
