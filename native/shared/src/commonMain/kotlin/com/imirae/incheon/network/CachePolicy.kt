package com.imirae.incheon.network

import io.ktor.http.HttpMethod

data class EndpointCacheRule(
    val keyPrefix: String,
    val ttlMillis: Long,
    val cacheableMethods: Set<HttpMethod> = setOf(HttpMethod.Get),
)

data class CacheInvalidationRule(
    val methods: Set<HttpMethod>,
    val endpointPattern: Regex,
    val invalidatePrefixes: Set<String>,
)

class CachePolicy(
    private val endpointRules: List<Pair<Regex, EndpointCacheRule>> = DEFAULT_ENDPOINT_RULES,
    private val invalidationRules: List<CacheInvalidationRule> = DEFAULT_INVALIDATION_RULES,
) {
    fun resolveRule(endpointPath: String, method: HttpMethod): EndpointCacheRule? {
        val normalizedPath = endpointPath.normalizeEndpointPath()
        return endpointRules
            .firstOrNull { (pattern, rule) ->
                pattern.matches(normalizedPath) && method in rule.cacheableMethods
            }
            ?.second
    }

    fun buildCacheKey(
        endpointPath: String,
        queryParams: Map<String, String> = emptyMap(),
        method: HttpMethod = HttpMethod.Get,
    ): String? {
        val normalizedPath = endpointPath.normalizeEndpointPath()
        val rule = resolveRule(endpointPath = normalizedPath, method = method) ?: return null

        if (queryParams.isEmpty()) {
            return "${rule.keyPrefix}:$normalizedPath"
        }

        val normalizedQuery = queryParams.toSortedMap()
            .entries
            .joinToString(separator = "&") { (key, value) -> "$key=$value" }

        return "${rule.keyPrefix}:$normalizedPath?$normalizedQuery"
    }

    fun invalidationPrefixesFor(endpointPath: String, method: HttpMethod): Set<String> {
        val normalizedPath = endpointPath.normalizeEndpointPath()
        return invalidationRules
            .filter { rule -> method in rule.methods && rule.endpointPattern.matches(normalizedPath) }
            .flatMap { it.invalidatePrefixes }
            .toSet()
    }

    private fun String.normalizeEndpointPath(): String {
        val pathWithoutQuery = substringBefore(delimiter = '?')
        if (pathWithoutQuery.isBlank()) return "/"
        return if (pathWithoutQuery.startsWith('/')) pathWithoutQuery else "/$pathWithoutQuery"
    }

    companion object {
        const val TTL_CLIENT_LIST_MILLIS = 30_000L
        const val TTL_DASHBOARD_MILLIS = 60_000L
        const val TTL_SETTINGS_MILLIS = 300_000L
        const val TTL_EMPLOYEE_LIST_MILLIS = 45_000L

        val DEFAULT_ENDPOINT_RULES: List<Pair<Regex, EndpointCacheRule>> = listOf(
            Regex("^/api/clients$") to EndpointCacheRule(
                keyPrefix = "clients",
                ttlMillis = TTL_CLIENT_LIST_MILLIS,
            ),
            Regex("^/api/dashboard$") to EndpointCacheRule(
                keyPrefix = "dashboard",
                ttlMillis = TTL_DASHBOARD_MILLIS,
            ),
            Regex("^/api/settings$") to EndpointCacheRule(
                keyPrefix = "settings",
                ttlMillis = TTL_SETTINGS_MILLIS,
            ),
            Regex("^/api/employees$") to EndpointCacheRule(
                keyPrefix = "employees",
                ttlMillis = TTL_EMPLOYEE_LIST_MILLIS,
            ),
        )

        private val MUTATION_METHODS = setOf(
            HttpMethod.Post,
            HttpMethod.Put,
            HttpMethod.Patch,
            HttpMethod.Delete,
        )

        val DEFAULT_INVALIDATION_RULES: List<CacheInvalidationRule> = listOf(
            CacheInvalidationRule(
                methods = MUTATION_METHODS,
                endpointPattern = Regex("^/api/clients(?:/.+)?$"),
                invalidatePrefixes = setOf("clients", "dashboard"),
            ),
            CacheInvalidationRule(
                methods = MUTATION_METHODS,
                endpointPattern = Regex("^/api/employees(?:/.+)?$"),
                invalidatePrefixes = setOf("employees", "dashboard"),
            ),
            CacheInvalidationRule(
                methods = MUTATION_METHODS,
                endpointPattern = Regex("^/api/settings(?:/.+)?$"),
                invalidatePrefixes = setOf("settings", "dashboard"),
            ),
            CacheInvalidationRule(
                methods = MUTATION_METHODS,
                endpointPattern = Regex("^/api/templates(?:/.+)?$"),
                invalidatePrefixes = setOf("templates"),
            ),
        )
    }
}
