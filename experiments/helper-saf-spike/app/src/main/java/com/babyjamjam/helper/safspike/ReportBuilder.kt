package com.babyjamjam.helper.safspike

import android.os.Build

object ReportBuilder {
    fun build(store: ObservationStore): String {
        val events = store.read()
        return buildString {
            append("{\n")
            append("  \"schemaVersion\":2,\n")
            append("  \"generatedAtEpochMs\":").append(System.currentTimeMillis()).append(",\n")
            append("  \"device\":{")
            append("\"model\":").append(jsonString(Build.MODEL)).append(",")
            append("\"sdk\":").append(Build.VERSION.SDK_INT).append(",")
            append("\"release\":").append(jsonString(Build.VERSION.RELEASE)).append("},\n")
            append("  \"truncationMarker\":")
                .append(if (store.wasTruncated()) jsonString("events_truncated") else "null")
                .append(",\n")
            append("  \"events\":[\n")
            events.forEachIndexed { index, event ->
                if (index > 0) append(",\n")
                appendEvent(event)
            }
            append("\n  ]\n}")
        }
    }

    private fun StringBuilder.appendEvent(event: StoredObservation) {
        append("    {")
        append("\"timestampEpochMs\":").append(event.timestampEpochMs).append(",")
        append("\"stage\":").append(jsonString(event.stage.name)).append(",")
        append("\"grantStatus\":").append(jsonString(event.grantStatus.name)).append(",")
        append("\"listingStatus\":").append(jsonString(event.listingStatus.name)).append(",")
        append("\"kind\":").append(jsonString(event.kind.name)).append(",")
        append("\"change\":").append(jsonString(event.change.name)).append(",")
        append("\"providerLoading\":").append(event.providerLoading).append(",")
        append("\"entryCapReached\":").append(event.entryCapReached).append(",")
        append("\"legacyIncomplete\":").append(event.legacyIncomplete).append(",")
        append("\"truncated\":").append(event.incomplete).append(",")
        append("\"readProbeStatus\":")
            .append(event.readProbeStatus?.let { jsonString(it.name) } ?: "null")
            .append(",")
        append("\"entries\":[")
        event.entries.forEachIndexed { index, entry ->
            if (index > 0) append(",")
            append("{")
            append("\"id\":").append(jsonString(entry.id)).append(",")
            append("\"nameFingerprint\":").append(jsonString(entry.nameFingerprint)).append(",")
            append("\"size\":").append(entry.size ?: "null").append(",")
            append("\"lastModifiedEpochMs\":").append(entry.lastModifiedEpochMs ?: "null").append(",")
            append("\"readProbeStatus\":")
                .append(entry.readProbeStatus?.let { jsonString(it.name) } ?: "null")
            append("}")
        }
        append("]}")
    }

    private fun jsonString(value: String?): String {
        if (value == null) return "null"
        val escaped = buildString {
            value.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (character.code < 0x20) {
                        append("\\u").append(character.code.toString(16).padStart(4, '0'))
                    } else {
                        append(character)
                    }
                }
            }
        }
        return "\"$escaped\""
    }
}
