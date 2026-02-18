package com.imirae.incheon.observability

import com.imirae.incheon.auth.currentTimeMillis

object CrashReporting {
    fun initialize(isDebug: Boolean) { if (isDebug) return }
    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        val sanitized = sanitizeMessage(message)
        println("[CrashReporting] $tag: $sanitized")
    }
    fun setUserId(userId: String) {}
    fun clearUserId() {}
    fun recordMetric(name: String, value: Long) {}

    private fun sanitizeMessage(message: String): String = message
        .replace(Regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"), "[EMAIL]")
        .replace(Regex("01[0-9]-?[0-9]{3,4}-?[0-9]{4}"), "[PHONE]")
        .replace(Regex("Bearer [a-zA-Z0-9._-]+"), "Bearer [TOKEN]")
        .replace(Regex("eyJ[a-zA-Z0-9._-]+"), "[JWT]")
}

object PerformanceTelemetry {
    private var appStartTime: Long = 0
    fun markAppStart() { appStartTime = currentTimeMillis() }
    fun markAppReady() {
        val startupTime = currentTimeMillis() - appStartTime
        CrashReporting.recordMetric("startup_time_ms", startupTime)
        if (startupTime > 2000) CrashReporting.logError("Performance", "Slow startup: ${startupTime}ms (target: <2000ms)")
    }
    fun recordFrameDrop(droppedFrames: Int) { if (droppedFrames > 5) CrashReporting.recordMetric("frame_drops", droppedFrames.toLong()) }
    fun recordNetworkError(endpoint: String, statusCode: Int) { CrashReporting.recordMetric("network_error_$statusCode", 1) }
}
