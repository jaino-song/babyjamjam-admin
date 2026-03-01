package com.imirae.incheon.logging

import com.imirae.incheon.auth.currentTimeMillis
import kotlin.concurrent.Volatile

object SafeLogger {
    enum class Level(val value: String) {
        DEBUG("debug"), INFO("info"), WARN("warn"), ERROR("error"), SECURITY("security")
    }
    enum class Service(val value: String) {
        ANDROID_APP("android-app"), IOS_APP("ios-app"), KMP_SHARED("kmp-shared")
    }
    enum class Environment(val value: String) {
        DEV("dev"), STAGE("stage"), PROD("prod")
    }
    private enum class RedactionKind { TOKEN, PII, RECORDING, NONE }

    private const val REDACTED_TOKEN = "[REDACTED_TOKEN]"
    private const val REDACTED_PII = "[REDACTED_PII]"
    private const val REDACTED_RECORDING = "[REDACTED_RECORDING_METADATA]"

    private val tokenKeyHints = listOf("token", "authorization", "password", "passwd", "otp", "secret", "api_key", "apikey", "credential", "cookie")
    private val piiKeyHints = listOf("email", "phone", "address", "birth", "dob", "name")
    private val recordingKeyHints = listOf("recording", "audio", "voice", "uri", "path", "file", "duration", "size", "checksum", "mime")
    private val emailRegex = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
    private val phoneRegex = Regex("\\b(?:\\+?\\d{1,3}[\\s-]?)?(?:\\d{2,3}[\\s-]?)?\\d{3,4}[\\s-]?\\d{4}\\b")
    private val bearerTokenRegex = Regex("(?i)bearer\\s+[A-Za-z0-9._\\-+/=]+")
    private val jwtRegex = Regex("\\beyJ[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\b")
    private val tokenAssignmentRegex = Regex("(?i)(access_token|refresh_token|id_token|token|authorization|api[_-]?key|secret|password|passwd|otp)\\s*[:=]\\s*([^,;\\s]+)")
    private val tokenQueryRegex = Regex("(?i)([?&](?:access_token|refresh_token|id_token|token|api_key)=)[^&\\s]+")
    private val recordingUriRegex = Regex("(?i)(content|file)://[^\\s]+")
    private val recordingPathRegex = Regex("(?i)/(?:storage|sdcard|data)/[^\\s]+")
    private val recordingFileRegex = Regex("(?i)\\b[\\w.-]+\\.(mp3|m4a|3gp|amr|wav|ogg|aac|flac)\\b")

    @Volatile private var currentEnvironment = Environment.DEV
    @Volatile private var currentService = Service.KMP_SHARED

    fun configure(environment: Environment, service: Service = currentService) { currentEnvironment = environment; currentService = service }

    fun debug(eventType: String, message: String? = null, context: Map<String, Any?> = emptyMap(), requestId: String? = null, traceId: String? = null, result: String? = null, errorCode: String? = null) = log(Level.DEBUG, eventType, message, context, requestId, traceId, result, errorCode)
    fun info(eventType: String, message: String? = null, context: Map<String, Any?> = emptyMap(), requestId: String? = null, traceId: String? = null, result: String? = null, errorCode: String? = null) = log(Level.INFO, eventType, message, context, requestId, traceId, result, errorCode)
    fun warn(eventType: String, message: String? = null, context: Map<String, Any?> = emptyMap(), requestId: String? = null, traceId: String? = null, result: String? = null, errorCode: String? = null) = log(Level.WARN, eventType, message, context, requestId, traceId, result, errorCode)
    fun error(eventType: String, message: String? = null, context: Map<String, Any?> = emptyMap(), requestId: String? = null, traceId: String? = null, result: String? = null, errorCode: String? = null) = log(Level.ERROR, eventType, message, context, requestId, traceId, result, errorCode)
    fun security(eventType: String, message: String? = null, context: Map<String, Any?> = emptyMap(), requestId: String? = null, traceId: String? = null, result: String? = null, errorCode: String? = null) = log(Level.SECURITY, eventType, message, context, requestId, traceId, result, errorCode)

    fun hashIdentifier(raw: String): String = if (raw.isBlank()) "anon" else "h_${raw.hashCode().toUInt().toString(16)}"

    private fun log(level: Level, eventType: String, message: String?, context: Map<String, Any?>, requestId: String?, traceId: String?, result: String?, errorCode: String?) {
        if (!shouldEmit(level)) return
        val fields = linkedMapOf<String, String>()
        fields["timestamp"] = currentTimeMillis().toString()
        fields["level"] = level.value
        fields["service"] = currentService.value
        fields["environment"] = currentEnvironment.value
        fields["event_type"] = sanitizeEventType(eventType)
        requestId?.let { fields["request_id"] = sanitizeText(it) }
        traceId?.let { fields["trace_id"] = sanitizeText(it) }
        result?.let { fields["result"] = sanitizeText(it) }
        errorCode?.let { fields["error_code"] = sanitizeText(it) }
        message?.let { fields["message"] = sanitizeText(it) }
        val safeContext = sanitizeContext(context)
        if (safeContext.isNotEmpty()) fields["context"] = toJsonObject(safeContext)
        println(fields.entries.joinToString(" ") { "${it.key}=\"${escape(it.value)}\"" })
    }

    private fun shouldEmit(level: Level): Boolean = currentEnvironment != Environment.PROD || level != Level.DEBUG
    private fun sanitizeEventType(eventType: String): String { val n = eventType.lowercase().replace(Regex("[^a-z0-9._-]"), "_"); return if (n.isBlank()) "unknown.event" else n }

    private fun sanitizeContext(context: Map<String, Any?>): Map<String, String> {
        if (context.isEmpty()) return emptyMap()
        val sanitized = linkedMapOf<String, String>()
        for ((key, value) in context) sanitized[key] = sanitizeByKey(key, value)
        return sanitized
    }

    private fun sanitizeByKey(key: String, value: Any?): String = when (classifyKey(key)) {
        RedactionKind.TOKEN -> REDACTED_TOKEN; RedactionKind.PII -> REDACTED_PII
        RedactionKind.RECORDING -> REDACTED_RECORDING; RedactionKind.NONE -> sanitizeValue(value)
    }

    private fun classifyKey(key: String): RedactionKind {
        val n = key.lowercase()
        return when {
            tokenKeyHints.any { n.contains(it) } -> RedactionKind.TOKEN
            recordingKeyHints.any { n.contains(it) } -> RedactionKind.RECORDING
            piiKeyHints.any { n.contains(it) } -> RedactionKind.PII
            else -> RedactionKind.NONE
        }
    }

    private fun sanitizeValue(value: Any?): String = when (value) {
        null -> "null"; is String -> sanitizeText(value); is Number -> value.toString()
        is Boolean -> value.toString(); is Map<*, *> -> sanitizeMap(value)
        is Iterable<*> -> value.joinToString(prefix = "[", postfix = "]") { sanitizeValue(it) }
        else -> sanitizeText(value.toString())
    }

    private fun sanitizeMap(map: Map<*, *>): String {
        if (map.isEmpty()) return "{}"
        val pairs = map.entries.joinToString(",") { entry ->
            val key = entry.key?.toString() ?: "null"
            "\"${escape(key)}\":\"${escape(sanitizeByKey(key, entry.value))}\""
        }
        return "{$pairs}"
    }

    private fun sanitizeText(input: String): String = input
        .replace(emailRegex, REDACTED_PII).replace(phoneRegex, REDACTED_PII)
        .replace(bearerTokenRegex, "Bearer $REDACTED_TOKEN").replace(jwtRegex, REDACTED_TOKEN)
        .replace(tokenAssignmentRegex) { m -> "${m.groupValues[1]}=$REDACTED_TOKEN" }
        .replace(tokenQueryRegex) { m -> "${m.groupValues[1]}$REDACTED_TOKEN" }
        .replace(recordingUriRegex, REDACTED_RECORDING).replace(recordingPathRegex, REDACTED_RECORDING)
        .replace(recordingFileRegex, REDACTED_RECORDING)

    private fun toJsonObject(values: Map<String, String>): String = values.entries.joinToString(prefix = "{", postfix = "}", separator = ",") { "\"${escape(it.key)}\":\"${escape(it.value)}\"" }
    private fun escape(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")
}
