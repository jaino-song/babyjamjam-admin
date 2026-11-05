package com.babyjamjam.helper.safspike

import java.io.FileNotFoundException
import java.nio.charset.StandardCharsets
import javax.crypto.Mac
import javax.crypto.SecretKey

const val MAX_VISIBLE_ENTRIES = 200

enum class Stage(val label: String) {
    BASELINE("기준선"),
    DURING_CALL("통화 중"),
    AFTER_CALL("통화 후"),
    AFTER_REBOOT("재부팅 후"),
    RENAME("이름 변경"),
    PERMISSION_REVOKED("권한 해제 후"),
}

enum class GrantStatus { NOT_SELECTED, GRANTED, MISSING, ERROR }

enum class ProviderStatus {
    OK,
    PERMISSION_DENIED,
    NOT_FOUND,
    INVALID_URI,
    PROVIDER_ERROR,
}

enum class ObservationKind { MANUAL_SCAN, SAMPLE, READ_PROBE, STAGE_MARKER, REVOKE }

enum class ChangeObservation { FIRST, CHANGED, UNCHANGED, INCOMPLETE }

enum class ReadProbeStatus {
    READ_ONE_BYTE,
    EMPTY,
    PERMISSION_DENIED,
    NOT_FOUND,
    INVALID_URI,
    PROVIDER_ERROR,
}

data class DocumentMetadata(
    val documentId: String,
    val displayName: String?,
    val size: Long?,
    val lastModifiedEpochMs: Long?,
    val mimeType: String?,
)

data class ListingResult(
    val entries: List<DocumentMetadata>,
    val providerLoading: Boolean = false,
    val entryCapReached: Boolean = false,
    val status: ProviderStatus = ProviderStatus.OK,
) {
    val incomplete: Boolean get() = providerLoading || entryCapReached
}

data class ObservationSnapshot(
    val entries: List<DocumentMetadata>,
    val providerLoading: Boolean = false,
    val entryCapReached: Boolean = false,
) {
    val incomplete: Boolean get() = providerLoading || entryCapReached
}

data class ReportEntry(
    val id: String,
    val nameFingerprint: String,
    val size: Long?,
    val lastModifiedEpochMs: Long?,
    val readProbeStatus: ReadProbeStatus? = null,
)

data class StoredObservation(
    val timestampEpochMs: Long,
    val stage: Stage,
    val grantStatus: GrantStatus,
    val listingStatus: ProviderStatus,
    val kind: ObservationKind,
    val change: ChangeObservation,
    val entries: List<ReportEntry>,
    val readProbeStatus: ReadProbeStatus? = null,
    val providerLoading: Boolean = false,
    val entryCapReached: Boolean = false,
    val legacyIncomplete: Boolean = false,
) {
    val incomplete: Boolean get() = providerLoading || entryCapReached || legacyIncomplete
}

data class BoundedRows<T>(
    val rows: List<T>,
    val entryCapReached: Boolean,
)

data class ScanToken(
    val generation: Long,
    val uri: String,
    val stage: Stage,
    val kind: ObservationKind,
)

class ScanFence {
    private var generation = 0L

    fun dispatch(uri: String, stage: Stage, kind: ObservationKind): ScanToken {
        generation += 1
        return ScanToken(generation, uri, stage, kind)
    }

    fun invalidate() {
        generation += 1
    }

    fun accepts(token: ScanToken, activeUri: String?): Boolean =
        token.generation == generation && token.uri == activeUri
}

class SamplingGate {
    private var active = false
    private var inFlight = false

    fun start() {
        active = true
        inFlight = false
    }

    fun stop() {
        active = false
        inFlight = false
    }

    fun tryStart(): Boolean {
        if (!active || inFlight) return false
        inFlight = true
        return true
    }

    fun complete(): Boolean {
        if (!active || !inFlight) return false
        inFlight = false
        return true
    }

    fun cancel() {
        inFlight = false
    }
}

fun <T> takeAtMostCapPlusOne(
    rows: Iterator<T>,
    cap: Int = MAX_VISIBLE_ENTRIES,
): BoundedRows<T> {
    val visible = ArrayList<T>(cap)
    var count = 0
    while (count <= cap && rows.hasNext()) {
        val row = rows.next()
        count++
        if (count <= cap) visible += row
    }
    return BoundedRows(visible, count > cap)
}

fun limitListing(
    entries: List<DocumentMetadata>,
    status: ProviderStatus = ProviderStatus.OK,
    providerLoading: Boolean = false,
): ListingResult {
    val bounded = takeAtMostCapPlusOne(entries.iterator())
    return ListingResult(
        entries = bounded.rows,
        providerLoading = providerLoading,
        entryCapReached = bounded.entryCapReached,
        status = status,
    )
}

fun compareSnapshots(
    previous: ObservationSnapshot?,
    current: ObservationSnapshot,
): ChangeObservation {
    if (previous == null) return ChangeObservation.FIRST
    if (previous.incomplete || current.incomplete) return ChangeObservation.INCOMPLETE

    val before = previous.entries.associateBy { it.documentId }
    val after = current.entries.associateBy { it.documentId }
    if (before.keys != after.keys) return ChangeObservation.CHANGED
    return if (before.all { (id, old) ->
            val new = after.getValue(id)
            old.displayName == new.displayName &&
                old.size == new.size &&
                old.lastModifiedEpochMs == new.lastModifiedEpochMs &&
                old.mimeType == new.mimeType
        }
    ) {
        ChangeObservation.UNCHANGED
    } else {
        ChangeObservation.CHANGED
    }
}

fun normalizeProviderFailure(error: Throwable): ProviderStatus = when (error) {
    is SecurityException -> ProviderStatus.PERMISSION_DENIED
    is FileNotFoundException -> ProviderStatus.NOT_FOUND
    is IllegalArgumentException -> ProviderStatus.INVALID_URI
    else -> ProviderStatus.PROVIDER_ERROR
}

fun providerStatusToProbeStatus(status: ProviderStatus): ReadProbeStatus = when (status) {
    ProviderStatus.PERMISSION_DENIED -> ReadProbeStatus.PERMISSION_DENIED
    ProviderStatus.NOT_FOUND -> ReadProbeStatus.NOT_FOUND
    ProviderStatus.INVALID_URI -> ReadProbeStatus.INVALID_URI
    ProviderStatus.PROVIDER_ERROR, ProviderStatus.OK -> ReadProbeStatus.PROVIDER_ERROR
}

class HmacRedactor(private val key: SecretKey) {
    fun fingerprint(kind: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(key)
        val bytes = mac.doFinal((kind + '\u0000' + value).toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
