package com.babyjamjam.helper.safspike

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets

object ObservationCodec {
    fun encode(event: StoredObservation): String {
        val entries = event.entries.joinToString(separator = ";") { entry ->
            listOf(
                entry.id,
                entry.nameFingerprint,
                entry.size?.toString() ?: "-",
                entry.lastModifiedEpochMs?.toString() ?: "-",
                entry.readProbeStatus?.name ?: "-",
            ).joinToString(separator = ",")
        }
        return listOf(
            "2",
            event.timestampEpochMs,
            event.stage.name,
            event.grantStatus.name,
            event.listingStatus.name,
            event.kind.name,
            if (event.providerLoading) "1" else "0",
            if (event.entryCapReached) "1" else "0",
            if (event.legacyIncomplete) "1" else "0",
            event.change.name,
            event.readProbeStatus?.name ?: "-",
            entries,
        ).joinToString(separator = "\t")
    }

    fun decode(line: String): StoredObservation? {
        val fields = line.split('\t', limit = 12)
        return when (fields.firstOrNull()) {
            "1" -> decodeV1(fields)
            "2" -> decodeV2(fields)
            else -> null
        }
    }

    private fun decodeV1(fields: List<String>): StoredObservation? {
        if (fields.size != 10) return null
        val timestamp = fields[1].toLongOrNull() ?: return null
        val stage = enumOrNull<Stage>(fields[2]) ?: return null
        val grant = enumOrNull<GrantStatus>(fields[3]) ?: return null
        val listing = enumOrNull<ProviderStatus>(fields[4]) ?: return null
        val kind = enumOrNull<ObservationKind>(fields[5]) ?: return null
        val change = enumOrNull<ChangeObservation>(fields[7]) ?: return null
        val readProbe = fields[8].takeUnless { it == "-" }?.let { enumOrNull<ReadProbeStatus>(it) }
        val entries = decodeEntries(fields[9])
        return StoredObservation(
            timestampEpochMs = timestamp,
            stage = stage,
            grantStatus = grant,
            listingStatus = listing,
            kind = kind,
            change = change,
            entries = entries,
            readProbeStatus = readProbe,
            legacyIncomplete = fields[6] == "1",
        )
    }

    private fun decodeV2(fields: List<String>): StoredObservation? {
        if (fields.size != 12) return null
        val timestamp = fields[1].toLongOrNull() ?: return null
        val stage = enumOrNull<Stage>(fields[2]) ?: return null
        val grant = enumOrNull<GrantStatus>(fields[3]) ?: return null
        val listing = enumOrNull<ProviderStatus>(fields[4]) ?: return null
        val kind = enumOrNull<ObservationKind>(fields[5]) ?: return null
        val providerLoading = parseFlag(fields[6]) ?: return null
        val entryCapReached = parseFlag(fields[7]) ?: return null
        val legacyIncomplete = parseFlag(fields[8]) ?: return null
        val change = enumOrNull<ChangeObservation>(fields[9]) ?: return null
        val readProbe = fields[10].takeUnless { it == "-" }?.let { enumOrNull<ReadProbeStatus>(it) }
        return StoredObservation(
            timestampEpochMs = timestamp,
            stage = stage,
            grantStatus = grant,
            listingStatus = listing,
            kind = kind,
            change = change,
            entries = decodeEntries(fields[11]),
            readProbeStatus = readProbe,
            providerLoading = providerLoading,
            entryCapReached = entryCapReached,
            legacyIncomplete = legacyIncomplete,
        )
    }

    private fun decodeEntries(encoded: String): List<ReportEntry> = if (encoded.isEmpty()) {
        emptyList()
    } else {
        encoded.split(';').mapNotNull { value ->
            val fields = value.split(',', limit = 5)
            if (fields.size != 5) return@mapNotNull null
            val size = fields[2].takeUnless { it == "-" }?.toLongOrNull()
            val modified = fields[3].takeUnless { it == "-" }?.toLongOrNull()
            val status = fields[4].takeUnless { it == "-" }?.let { enumOrNull<ReadProbeStatus>(it) }
            if (fields[0].isBlank() || fields[1].isBlank()) return@mapNotNull null
            ReportEntry(fields[0], fields[1], size, modified, status)
        }
    }

    private fun parseFlag(value: String): Boolean? = when (value) {
        "0" -> false
        "1" -> true
        else -> null
    }

    private inline fun <reified T : Enum<T>> enumOrNull(value: String): T? =
        runCatching { enumValueOf<T>(value) }.getOrNull()
}

class ObservationStore(context: Context) {
    private val appContext = context.applicationContext
    private val eventsFile: File
        get() = File(appContext.filesDir, EVENTS_FILE)
    private val prefs by lazy {
        appContext.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun append(event: StoredObservation) {
        eventsFile.parentFile?.mkdirs()
        FileOutputStream(eventsFile, true).use { output ->
            output.write((ObservationCodec.encode(event) + "\n").toByteArray(StandardCharsets.UTF_8))
        }
        trimIfNeeded()
    }

    @Synchronized
    fun read(): List<StoredObservation> = if (!eventsFile.isFile) {
        emptyList()
    } else {
        eventsFile.readLines(StandardCharsets.UTF_8).mapNotNull(ObservationCodec::decode)
    }

    fun wasTruncated(): Boolean = prefs.getBoolean(TRUNCATED_KEY, false)

    private fun trimIfNeeded() {
        if (eventsFile.length() <= MAX_BYTES) {
            val lineCount = eventsFile.useLines { lines -> lines.count() }
            if (lineCount <= MAX_EVENTS) return
        }
        val kept = eventsFile.readLines(StandardCharsets.UTF_8).takeLast(MAX_EVENTS).toMutableList()
        while (kept.isNotEmpty() && kept.joinToString("\n").toByteArray(StandardCharsets.UTF_8).size > MAX_BYTES) {
            kept.removeAt(0)
        }
        FileOutputStream(eventsFile, false).use { output ->
            if (kept.isNotEmpty()) {
                output.write((kept.joinToString("\n") + "\n").toByteArray(StandardCharsets.UTF_8))
            }
        }
        prefs.edit().putBoolean(TRUNCATED_KEY, true).apply()
    }

    companion object {
        private const val EVENTS_FILE = "observations.v1"
        private const val STATE_PREFS = "saf_spike_private_state"
        private const val TRUNCATED_KEY = "observations_truncated"
        private const val MAX_EVENTS = 256
        private const val MAX_BYTES = 512 * 1024L
    }
}
