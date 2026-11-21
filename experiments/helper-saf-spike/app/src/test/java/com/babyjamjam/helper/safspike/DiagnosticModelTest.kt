package com.babyjamjam.helper.safspike

import java.nio.charset.StandardCharsets
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticModelTest {
    @Test
    fun nullableMetadataIsPreservedAndOverflowIsMarked() {
        val entries = (0..MAX_VISIBLE_ENTRIES).map { index ->
            DocumentMetadata("doc-$index", null, null, null, "audio/3gpp")
        }

        val result = limitListing(entries)

        assertEquals(MAX_VISIBLE_ENTRIES, result.entries.size)
        assertFalse(result.providerLoading)
        assertTrue(result.entryCapReached)
        assertTrue(result.incomplete)
        assertEquals(null, result.entries.first().size)
        assertEquals(null, result.entries.first().lastModifiedEpochMs)
    }

    @Test
    fun providerLoadingAndEntryCapRemainDistinct() {
        val visible = (0 until MAX_VISIBLE_ENTRIES).map { index ->
            DocumentMetadata("doc-$index", "file-$index.m4a", null, null, "audio/mp4")
        }
        val overflow = visible + DocumentMetadata(
            "directory",
            "subfolder",
            null,
            null,
            "vnd.android.document/directory",
        )

        val loadingOnly = limitListing(visible, providerLoading = true)
        assertTrue(loadingOnly.providerLoading)
        assertFalse(loadingOnly.entryCapReached)
        assertTrue(loadingOnly.incomplete)

        val capOnly = limitListing(overflow)
        assertFalse(capOnly.providerLoading)
        assertTrue(capOnly.entryCapReached)

        val both = limitListing(overflow, providerLoading = true)
        assertTrue(both.providerLoading)
        assertTrue(both.entryCapReached)
    }

    @Test
    fun boundedEnumerationStopsAtCapPlusOneIncludingDirectories() {
        val rows = (0 until MAX_VISIBLE_ENTRIES + 40).map { index ->
            DocumentMetadata(
                "doc-$index",
                "file-$index",
                null,
                null,
                if (index == MAX_VISIBLE_ENTRIES - 1) {
                    "vnd.android.document/directory"
                } else {
                    "audio/mp4"
                },
            )
        }
        var consumed = 0
        val iterator = object : Iterator<DocumentMetadata> {
            override fun hasNext(): Boolean = consumed < rows.size

            override fun next(): DocumentMetadata {
                val row = rows[consumed]
                consumed++
                return row
            }
        }

        val bounded = takeAtMostCapPlusOne(iterator)

        assertEquals(MAX_VISIBLE_ENTRIES, bounded.rows.size)
        assertTrue(bounded.entryCapReached)
        assertEquals(MAX_VISIBLE_ENTRIES + 1, consumed)
        assertEquals("vnd.android.document/directory", bounded.rows.last().mimeType)
    }

    @Test
    fun metadataChangesAreDetectedWithNullableValues() {
        val before = ObservationSnapshot(
            listOf(DocumentMetadata("doc", "1001.m4a", null, null, "audio/mp4")),
            providerLoading = false,
            entryCapReached = false,
        )
        val unchanged = before.copy(entries = before.entries.map { it.copy() })
        val renamed = before.copy(entries = before.entries.map { it.copy(displayName = "1002.m4a") })
        val sized = before.copy(entries = before.entries.map { it.copy(size = 1L) })

        assertEquals(ChangeObservation.FIRST, compareSnapshots(null, before))
        assertEquals(ChangeObservation.UNCHANGED, compareSnapshots(before, unchanged))
        assertEquals(ChangeObservation.CHANGED, compareSnapshots(before, renamed))
        assertEquals(ChangeObservation.CHANGED, compareSnapshots(before, sized))
    }

    @Test
    fun incompleteSnapshotNeverClaimsStability() {
        val full = ObservationSnapshot(
            listOf(DocumentMetadata("doc", "voice.m4a", 5L, 7L, "audio/mp4")),
            providerLoading = false,
            entryCapReached = false,
        )
        val partial = full.copy(providerLoading = true)

        assertEquals(ChangeObservation.INCOMPLETE, compareSnapshots(full, partial))
    }

    @Test
    fun staleScanTokenCannotBeCommittedAfterReplacementOrInvalidation() {
        val fence = ScanFence()
        val first = fence.dispatch("tree-A", Stage.BASELINE, ObservationKind.MANUAL_SCAN)
        val second = fence.dispatch("tree-B", Stage.DURING_CALL, ObservationKind.MANUAL_SCAN)
        val committedStages = mutableListOf<Stage>()

        if (fence.accepts(first, "tree-B")) committedStages += first.stage
        if (fence.accepts(second, "tree-B")) committedStages += second.stage

        assertEquals(listOf(Stage.DURING_CALL), committedStages)
        assertFalse(fence.accepts(first, "tree-A"))
        fence.invalidate()
        assertFalse(fence.accepts(second, "tree-B"))
    }

    @Test
    fun samplingGateKeepsSlowSampleAndStopInvalidatesIt() {
        val gate = SamplingGate()
        gate.start()

        assertTrue(gate.tryStart())
        assertFalse(gate.tryStart())
        assertFalse(gate.tryStart())
        assertTrue(gate.complete())
        assertTrue(gate.tryStart())

        gate.stop()
        assertFalse(gate.complete())
        assertFalse(gate.tryStart())
    }

    @Test
    fun legacyIncompleteEventDoesNotBecomeComplete() {
        val legacy = "1\t123\tBASELINE\tGRANTED\tOK\tMANUAL_SCAN\t1\tFIRST\t-\t"

        val event = ObservationCodec.decode(legacy)

        assertEquals(false, event?.providerLoading)
        assertEquals(false, event?.entryCapReached)
        assertTrue(event?.legacyIncomplete == true)
        assertTrue(event?.incomplete == true)
    }

    @Test
    fun codecRoundTripKeepsLoadingAndCapFlags() {
        val original = StoredObservation(
            timestampEpochMs = 123L,
            stage = Stage.BASELINE,
            grantStatus = GrantStatus.GRANTED,
            listingStatus = ProviderStatus.OK,
            kind = ObservationKind.MANUAL_SCAN,
            change = ChangeObservation.INCOMPLETE,
            entries = emptyList(),
            providerLoading = true,
            entryCapReached = false,
        )

        val decoded = ObservationCodec.decode(ObservationCodec.encode(original))

        assertEquals(true, decoded?.providerLoading)
        assertEquals(false, decoded?.entryCapReached)
        assertEquals(false, decoded?.legacyIncomplete)
        assertTrue(decoded?.incomplete == true)
    }

    @Test
    fun hmacIsStableButRedactsPhoneFilenameAndUri() {
        val key = SecretKeySpec("per-install-test-key".toByteArray(StandardCharsets.UTF_8), "HmacSHA256")
        val redactor = HmacRedactor(key)
        val filename = "010-1234-5678-voice.m4a"
        val sourceUri = "content://com.example.documents/tree/primary%3ARecordings/document/primary%3ARecordings%2F$filename"

        val first = redactor.fingerprint("filename", filename)
        val second = redactor.fingerprint("filename", filename)
        val uriId = redactor.fingerprint("document", sourceUri)

        assertEquals(first, second)
        assertNotEquals(first, uriId)
        assertFalse(first.contains(filename))
        assertFalse(uriId.contains(sourceUri))
        assertFalse(uriId.contains("content://"))
    }

    @Test
    fun providerFailuresNormalizeWithoutEchoingExceptionDetails() {
        val raw = "content://private.provider/010-1234-5678-voice.m4a"
        val status = normalizeProviderFailure(SecurityException(raw))

        assertEquals(ProviderStatus.PERMISSION_DENIED, status)
        assertFalse(status.name.contains(raw))
        assertEquals(ProviderStatus.PROVIDER_ERROR, normalizeProviderFailure(IllegalStateException(raw)))
    }
}
