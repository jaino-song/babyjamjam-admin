package com.imirae.incheon.network

import io.ktor.http.HttpMethod
import kotlin.random.Random

const val IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"

class IdempotencyKeyGenerator(
    private val random: Random = Random.Default,
    private val keyPrefix: String = DEFAULT_PREFIX,
) {
    fun shouldAttachKey(method: HttpMethod): Boolean = method in MUTATION_METHODS

    fun generateFor(method: HttpMethod): String? {
        if (!shouldAttachKey(method)) return null
        return generateKey()
    }

    fun generateKey(): String = "$keyPrefix${generateUuidV4()}"

    private fun generateUuidV4(): String {
        val bytes = ByteArray(UUID_BYTES)
        random.nextBytes(bytes)

        bytes[6] = ((bytes[6].toInt() and VERSION_MASK) or VERSION_4).toByte()
        bytes[8] = ((bytes[8].toInt() and VARIANT_MASK) or VARIANT_RFC_4122).toByte()

        val hex = bytes.joinToString(separator = "") {
            it.toUByte().toString(radix = 16).padStart(length = 2, padChar = '0')
        }

        return buildString {
            append(hex.substring(0, 8))
            append('-')
            append(hex.substring(8, 12))
            append('-')
            append(hex.substring(12, 16))
            append('-')
            append(hex.substring(16, 20))
            append('-')
            append(hex.substring(20, 32))
        }
    }

    companion object {
        private const val DEFAULT_PREFIX = "idemp_"
        private const val UUID_BYTES = 16
        private const val VERSION_MASK = 0x0f
        private const val VERSION_4 = 0x40
        private const val VARIANT_MASK = 0x3f
        private const val VARIANT_RFC_4122 = 0x80

        private val MUTATION_METHODS = setOf(
            HttpMethod.Post,
            HttpMethod.Put,
            HttpMethod.Patch,
        )
    }
}
