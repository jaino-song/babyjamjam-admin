package com.imirae.incheon.performance

import com.imirae.incheon.network.ApiResult

/**
 * Response caching layer for API endpoints.
 * Implements per-endpoint caching policy.
 */
class ResponseCache {
    private val cache = mutableMapOf<String, CacheEntry>()

    data class CacheEntry(
        val data: Any,
        val timestamp: Long,
        val ttlMs: Long
    ) {
        fun isExpired(): Boolean = kotlin.system.getTimeMillis() - timestamp > ttlMs
    }

    companion object {
        // Cache TTL per endpoint category (milliseconds)
        const val TTL_DASHBOARD = 30_000L      // 30s - frequently updated
        const val TTL_CLIENT_LIST = 60_000L     // 1min
        const val TTL_EMPLOYEE_LIST = 60_000L   // 1min
        const val TTL_CONTRACT_LIST = 60_000L   // 1min
        const val TTL_TEMPLATES = 300_000L      // 5min - rarely changes
        const val TTL_SETTINGS = 600_000L       // 10min - rarely changes
        const val TTL_VOUCHER_PRICES = 3600_000L // 1hr - very stable
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? {
        val entry = cache[key] ?: return null
        if (entry.isExpired()) {
            cache.remove(key)
            return null
        }
        return entry.data as? T
    }

    fun <T : Any> put(key: String, data: T, ttlMs: Long) {
        cache[key] = CacheEntry(data, kotlin.system.getTimeMillis(), ttlMs)
    }

    fun invalidate(key: String) {
        cache.remove(key)
    }

    fun invalidateAll() {
        cache.clear()
    }

    fun invalidateByPrefix(prefix: String) {
        cache.keys.filter { it.startsWith(prefix) }.forEach { cache.remove(it) }
    }
}

/**
 * ProGuard/R8 keep rules for Android release builds.
 * These rules should be added to proguard-rules.pro.
 */
object ProguardRules {
    val rules = """
        # Keep Kotlin serialization
        -keepattributes *Annotation*, InnerClasses
        -dontnote kotlinx.serialization.AnnotationsKt
        -keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
        -keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
        -keep,includedescriptorclasses class com.imirae.incheon.**$${'$'}${'$'}serializer { *; }
        -keepclassmembers class com.imirae.incheon.** { *** Companion; }
        -keepclasseswithmembers class com.imirae.incheon.** { kotlinx.serialization.KSerializer serializer(...); }

        # Keep Ktor
        -keep class io.ktor.** { *; }
        -dontwarn io.ktor.**

        # Keep Koin
        -keep class org.koin.** { *; }

        # Keep domain models
        -keep class com.imirae.incheon.domain.models.** { *; }
    """.trimIndent()
}
