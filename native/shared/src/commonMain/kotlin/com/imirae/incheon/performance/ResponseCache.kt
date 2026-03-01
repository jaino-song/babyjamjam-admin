package com.imirae.incheon.performance

import com.imirae.incheon.auth.currentTimeMillis

class ResponseCache {
    private val cache = mutableMapOf<String, CacheEntry>()

    data class CacheEntry(val data: Any, val timestamp: Long, val ttlMs: Long) {
        fun isExpired(): Boolean = currentTimeMillis() - timestamp > ttlMs
    }

    companion object {
        const val TTL_DASHBOARD = 30_000L
        const val TTL_CLIENT_LIST = 60_000L
        const val TTL_EMPLOYEE_LIST = 60_000L
        const val TTL_CONTRACT_LIST = 60_000L
        const val TTL_TEMPLATES = 300_000L
        const val TTL_SETTINGS = 600_000L
        const val TTL_VOUCHER_PRICES = 3600_000L
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? {
        val entry = cache[key] ?: return null
        if (entry.isExpired()) { cache.remove(key); return null }
        return entry.data as? T
    }

    fun <T : Any> put(key: String, data: T, ttlMs: Long) { cache[key] = CacheEntry(data, currentTimeMillis(), ttlMs) }
    fun invalidate(key: String) { cache.remove(key) }
    fun invalidateAll() { cache.clear() }
    fun invalidateByPrefix(prefix: String) { cache.keys.filter { it.startsWith(prefix) }.forEach { cache.remove(it) } }
}

object ProguardRules {
    val rules = """
        -keepattributes *Annotation*, InnerClasses
        -dontnote kotlinx.serialization.AnnotationsKt
        -keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
        -keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
        -keep,includedescriptorclasses class com.imirae.incheon.**${'$'}${'$'}serializer { *; }
        -keepclassmembers class com.imirae.incheon.** { *** Companion; }
        -keepclasseswithmembers class com.imirae.incheon.** { kotlinx.serialization.KSerializer serializer(...); }
        -keep class io.ktor.** { *; }
        -dontwarn io.ktor.**
        -keep class org.koin.** { *; }
        -keep class com.imirae.incheon.domain.models.** { *; }
    """.trimIndent()
}
