package com.babyjamjam.helper.safspike

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

class MainActivity : Activity() {
    private lateinit var access: SafAccess
    private lateinit var grantLifecycle: GrantLifecycleCoordinator
    private lateinit var store: ObservationStore
    private var redactor: HmacRedactor? = null
    private var treeUri: Uri? = null
    private var selectedDocument: DocumentMetadata? = null
    private var selectedStage = Stage.BASELINE
    private var previousSnapshot: ObservationSnapshot? = null
    private var sampling = false
    private var knownGrantStatus = GrantStatus.NOT_SELECTED
    private var ioPending = false

    private lateinit var grantView: TextView
    private lateinit var statusView: TextView
    private lateinit var filesContainer: LinearLayout
    private lateinit var scanButton: Button
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var probeButton: Button
    private lateinit var revokeButton: Button
    private lateinit var stageGroup: RadioGroup
    private val handler = Handler(Looper.getMainLooper())
    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scanFence = ScanFence()
    private val samplingGate = SamplingGate()
    private var pendingIoFuture: Future<*>? = null
    private var pendingCancellation: CancellationSignal? = null
    private var grantStatusGeneration = 0L
    private var grantStatusFuture: Future<*>? = null
    private val sampleRunnable = object : Runnable {
        override fun run() {
            if (!sampling) return
            performScan(ObservationKind.SAMPLE)
            handler.postDelayed(this, SAMPLE_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        access = SafAccess(this)
        store = ObservationStore(this)
        treeUri = loadTreeUri()
        grantLifecycle = GrantLifecycleCoordinator(
            backend = object : GrantLifecycleBackend {
                override fun grantStatus(uri: String): GrantStatus = access.grantStatus(Uri.parse(uri))

                override fun takeReadGrant(uri: String): GrantStatus = access.takeReadGrant(Uri.parse(uri))

                override fun releaseReadGrant(uri: String): ProviderStatus =
                    access.releaseReadGrant(Uri.parse(uri))
            },
            initialSelectedUri = treeUri?.toString(),
        )
        redactor = runCatching { InstallRedactor().load() }.getOrNull()
        setContentView(buildUi())
        refreshGrantStatusAsync()
        if (redactor == null) statusView.text = getString(R.string.key_error)
    }

    override fun onResume() {
        super.onResume()
        refreshGrantStatusAsync()
    }

    override fun onPause() {
        if (sampling) {
            stopSampling()
            statusView.text = getString(R.string.status_stopped_background)
        } else {
            invalidatePendingIo()
        }
        invalidateGrantStatusRequests()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(sampleRunnable)
        invalidatePendingIo()
        invalidateGrantStatusRequests()
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun buildUi(): View {
        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        scroll.addView(content)
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            val safeInsets = insets.getInsets(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
            )
            view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom)
            insets
        }

        content.addView(text(getString(R.string.title), 24f, true))
        content.addView(text(getString(R.string.intro), 16f, false))
        grantView = text("", 16f, true)
        content.addView(grantView)

        content.addView(actionButton(R.string.choose_tree) { chooseTree() })

        content.addView(text(getString(R.string.stage_title), 18f, true))
        stageGroup = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        Stage.entries.forEachIndexed { index, stage ->
            val radio = RadioButton(this).apply {
                id = View.generateViewId()
                text = stage.label
                minHeight = dp(48)
                textSize = 16f
                contentDescription = stage.label
                tag = stage
            }
            stageGroup.addView(radio)
            if (index == 0) stageGroup.check(radio.id)
        }
        stageGroup.setOnCheckedChangeListener { _, checkedId ->
            val stage = findViewById<RadioButton>(checkedId)?.tag as? Stage ?: return@setOnCheckedChangeListener
            selectedStage = stage
            recordEvent(
                StoredObservation(
                    timestampEpochMs = System.currentTimeMillis(),
                    stage = stage,
                    grantStatus = currentGrantStatus(),
                    listingStatus = ProviderStatus.OK,
                    kind = ObservationKind.STAGE_MARKER,
                    change = ChangeObservation.FIRST,
                    entries = emptyList(),
                ),
            )
            statusView.text = getString(R.string.stage_saved)
        }
        content.addView(stageGroup)

        scanButton = actionButton(R.string.scan) { performScan(ObservationKind.MANUAL_SCAN) }
        content.addView(scanButton)
        startButton = actionButton(R.string.start_sampling) { startSampling() }
        content.addView(startButton)
        stopButton = actionButton(R.string.stop_sampling) { stopSampling() }
        content.addView(stopButton)
        content.addView(actionButton(R.string.export_report) { exportReport() })
        revokeButton = actionButton(R.string.revoke_tree) { revokeTree() }
        content.addView(revokeButton)

        content.addView(text(getString(R.string.files_title), 18f, true))
        filesContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(filesContainer)
        content.addView(text(getString(R.string.select_for_probe), 15f, false))
        probeButton = actionButton(R.string.probe) { probeSelectedFile() }
        content.addView(probeButton)
        statusView = text(getString(R.string.status_waiting), 15f, false)
        content.addView(statusView)
        stopButton.isEnabled = false
        probeButton.isEnabled = false
        updateActionState()
        scroll.post { scroll.requestApplyInsets() }
        return scroll
    }

    private fun chooseTree() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(intent, REQUEST_TREE)
    }

    private data class PendingScan(
        val token: ScanToken,
        val uri: Uri,
        val cancellation: CancellationSignal,
        val grant: GrantStatus,
        val listing: ListingResult,
    )

    private fun performScan(kind: ObservationKind) {
        val uri = treeUri
        if (uri == null) {
            statusView.text = getString(R.string.grant_not_selected)
            return
        }
        if (kind == ObservationKind.SAMPLE && !samplingGate.tryStart()) return
        invalidatePendingIo(cancelSample = kind != ObservationKind.SAMPLE)
        val token = scanFence.dispatch(uri.toString(), selectedStage, kind)
        val cancellation = CancellationSignal()
        ioPending = true
        updateActionState()
        pendingCancellation = cancellation
        pendingIoFuture = ioExecutor.submit {
            val grant = runCatching { access.grantStatus(uri) }.getOrDefault(GrantStatus.ERROR)
            if (cancellation.isCanceled || Thread.currentThread().isInterrupted) return@submit
            val listing = if (grant == GrantStatus.GRANTED) {
                access.listDirectChildren(uri, cancellation)
            } else {
                ListingResult(entries = emptyList(), status = ProviderStatus.PERMISSION_DENIED)
            }
            if (cancellation.isCanceled || Thread.currentThread().isInterrupted) return@submit
            val result = PendingScan(token, uri, cancellation, grant, listing)
            handler.post {
                if (!isCurrentIo(result.token, result.cancellation)) return@post
                finishPendingIo()
                applyScan(result)
            }
        }
    }

    private fun applyScan(result: PendingScan) {
        if (result.token.kind == ObservationKind.SAMPLE) samplingGate.complete()
        knownGrantStatus = result.grant
        refreshGrantStatus(result.grant)
        val snapshot = ObservationSnapshot(
            entries = result.listing.entries,
            providerLoading = result.listing.providerLoading,
            entryCapReached = result.listing.entryCapReached,
        )
        val change = compareSnapshots(previousSnapshot, snapshot)
        previousSnapshot = snapshot
        val entries = result.listing.entries.mapNotNull { metadata -> metadata.toReportEntry(result.uri) }
        recordEvent(
            StoredObservation(
                timestampEpochMs = System.currentTimeMillis(),
                stage = result.token.stage,
                grantStatus = result.grant,
                listingStatus = result.listing.status,
                kind = result.token.kind,
                change = change,
                entries = entries,
                providerLoading = result.listing.providerLoading,
                entryCapReached = result.listing.entryCapReached,
            ),
        )
        selectedDocument = selectedDocument?.takeIf { selected ->
            result.listing.entries.any { it.documentId == selected.documentId }
        }
        renderListing(result.listing)
        statusView.text = when {
            result.listing.status != ProviderStatus.OK -> statusText(result.listing.status)
            result.listing.providerLoading && result.listing.entryCapReached ->
                getString(R.string.listing_loading_and_cap)
            result.listing.entryCapReached -> getString(R.string.truncated)
            result.listing.providerLoading -> getString(R.string.listing_loading)
            change == ChangeObservation.UNCHANGED -> getString(R.string.metadata_unchanged)
            change == ChangeObservation.CHANGED -> getString(R.string.metadata_changed)
            change == ChangeObservation.INCOMPLETE -> getString(R.string.metadata_incomplete)
            else -> getString(R.string.result_saved)
        }
        updateActionState()
    }

    private fun renderListing(listing: ListingResult) {
        filesContainer.removeAllViews()
        if (listing.entries.isEmpty()) {
            filesContainer.addView(text(getString(R.string.no_files), 15f, false))
        } else {
            filesContainer.addView(text(getString(R.string.files_count, listing.entries.size), 15f, true))
            listing.entries.forEach { metadata ->
                val label = buildString {
                    append(metadata.displayName ?: "(이름 없음)")
                    append("\n크기: ").append(metadata.size?.toString() ?: "알 수 없음")
                    append(" · 수정: ").append(metadata.lastModifiedEpochMs?.toString() ?: "알 수 없음")
                }
                filesContainer.addView(actionButtonText(label) {
                    invalidatePendingIo()
                    selectedDocument = metadata
                    statusView.text = getString(R.string.selected_file, metadata.displayName ?: "(이름 없음)")
                    updateActionState()
                })
            }
        }
        if (listing.providerLoading) {
            filesContainer.addView(text(getString(R.string.listing_loading), 15f, true))
        }
        if (listing.entryCapReached) {
            filesContainer.addView(text(getString(R.string.truncated), 15f, true))
        }
    }

    private fun startSampling() {
        val uri = treeUri
        if (uri == null || knownGrantStatus != GrantStatus.GRANTED) {
            refreshGrantStatusAsync()
            return
        }
        if (sampling) return
        sampling = true
        samplingGate.start()
        statusView.text = getString(R.string.status_sampling)
        performScan(ObservationKind.SAMPLE)
        handler.postDelayed(sampleRunnable, SAMPLE_INTERVAL_MS)
        updateActionState()
    }

    private fun stopSampling() {
        sampling = false
        handler.removeCallbacks(sampleRunnable)
        samplingGate.stop()
        invalidatePendingIo(cancelSample = false)
        updateActionState()
    }

    private data class PendingProbe(
        val token: ScanToken,
        val uri: Uri,
        val document: DocumentMetadata,
        val cancellation: CancellationSignal,
        val grant: GrantStatus,
        val probe: ReadProbeStatus,
    )

    private fun probeSelectedFile() {
        val uri = treeUri ?: return
        val document = selectedDocument ?: return
        invalidatePendingIo()
        val token = scanFence.dispatch(uri.toString(), selectedStage, ObservationKind.READ_PROBE)
        val cancellation = CancellationSignal()
        ioPending = true
        updateActionState()
        pendingCancellation = cancellation
        pendingIoFuture = ioExecutor.submit {
            val grant = runCatching { access.grantStatus(uri) }.getOrDefault(GrantStatus.ERROR)
            if (cancellation.isCanceled || Thread.currentThread().isInterrupted) return@submit
            val probe = if (grant == GrantStatus.GRANTED) {
                access.readOneByte(uri, document.documentId)
            } else {
                ReadProbeStatus.PERMISSION_DENIED
            }
            if (cancellation.isCanceled || Thread.currentThread().isInterrupted) return@submit
            val result = PendingProbe(token, uri, document, cancellation, grant, probe)
            handler.post {
                if (!isCurrentIo(result.token, result.cancellation) ||
                    selectedDocument?.documentId != result.document.documentId
                ) return@post
                finishPendingIo()
                knownGrantStatus = result.grant
                refreshGrantStatus(result.grant)
                val entry = result.document.toReportEntry(result.uri, result.probe)
                if (entry != null) {
                    recordEvent(
                        StoredObservation(
                            timestampEpochMs = System.currentTimeMillis(),
                            stage = result.token.stage,
                            grantStatus = result.grant,
                            listingStatus = probeStatusToProviderStatus(result.probe),
                            kind = result.token.kind,
                            change = ChangeObservation.FIRST,
                            entries = listOf(entry),
                            readProbeStatus = result.probe,
                        ),
                    )
                }
                statusView.text = when (result.probe) {
                    ReadProbeStatus.READ_ONE_BYTE -> getString(R.string.probe_read)
                    ReadProbeStatus.EMPTY -> getString(R.string.probe_empty)
                    else -> statusText(probeStatusToProviderStatus(result.probe))
                }
            }
        }
    }

    private fun exportReport() {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "saf-diagnostic-report.json")
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        startActivityForResult(intent, REQUEST_EXPORT)
    }

    private fun revokeTree() {
        if (treeUri == null) return
        stopSampling()
        invalidateGrantStatusRequests()
        val result = grantLifecycle.revoke()
        recordEvent(
            StoredObservation(
                timestampEpochMs = System.currentTimeMillis(),
                stage = Stage.PERMISSION_REVOKED,
                grantStatus = result.grantStatus,
                listingStatus = if (result.activeUri == null) {
                    ProviderStatus.PERMISSION_DENIED
                } else {
                    result.providerStatus
                },
                kind = ObservationKind.REVOKE,
                change = ChangeObservation.FIRST,
                entries = emptyList(),
            ),
        )
        syncSelectedUri(result.activeUri)
        refreshGrantStatus()
        if (result.activeUri == null) {
            selectedDocument = null
            previousSnapshot = null
            filesContainer.removeAllViews()
            filesContainer.addView(text(getString(R.string.no_files), 15f, false))
            statusView.text = getString(R.string.tree_revoke_done)
        } else {
            statusView.text = getString(R.string.tree_revoke_failed)
        }
        updateActionState()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data?.data == null) return
        when (requestCode) {
            REQUEST_TREE -> {
                val candidate = data.data ?: return
                invalidatePendingIo()
                invalidateGrantStatusRequests()
                val result = grantLifecycle.select(candidate.toString())
                syncSelectedUri(result.activeUri)
                when (result.outcome) {
                    GrantLifecycleOutcome.ACQUIRED,
                    GrantLifecycleOutcome.ALREADY_SELECTED,
                    GrantLifecycleOutcome.REPLACED,
                    -> {
                        selectedDocument = null
                        previousSnapshot = null
                        refreshGrantStatus()
                        performScan(ObservationKind.MANUAL_SCAN)
                    }

                    GrantLifecycleOutcome.RELEASE_FAILED -> {
                        refreshGrantStatus(result.grantStatus)
                        statusView.text = getString(R.string.tree_replacement_failed)
                    }

                    GrantLifecycleOutcome.TAKE_FAILED -> {
                        selectedDocument = null
                        previousSnapshot = null
                        refreshGrantStatus(result.grantStatus)
                        statusView.text = getString(R.string.tree_take_failed)
                    }

                    GrantLifecycleOutcome.ALREADY_REVOKED -> {
                        refreshGrantStatus(result.grantStatus)
                        statusView.text = getString(R.string.tree_take_failed)
                    }
                }
            }

            REQUEST_EXPORT -> {
                val destination = data.data ?: return
                val report = ReportBuilder.build(store)
                runCatching {
                    contentResolver.openOutputStream(destination)?.use { output ->
                        output.write(report.toByteArray(StandardCharsets.UTF_8))
                    } ?: error("output unavailable")
                }.onSuccess {
                    Toast.makeText(this, R.string.report_written, Toast.LENGTH_SHORT).show()
                }.onFailure {
                    statusView.text = getString(R.string.report_error)
                }
            }
        }
    }

    private fun refreshGrantStatus(status: GrantStatus = currentGrantStatus()) {
        knownGrantStatus = status
        grantView.text = getString(R.string.grant_label, grantText(status))
        updateActionState()
    }

    private fun refreshGrantStatusAsync() {
        val uri = treeUri
        val generation = ++grantStatusGeneration
        grantStatusFuture?.cancel(true)
        if (uri == null) {
            refreshGrantStatus(GrantStatus.NOT_SELECTED)
            return
        }
        grantStatusFuture = ioExecutor.submit {
            val status = runCatching { access.grantStatus(uri) }.getOrDefault(GrantStatus.ERROR)
            handler.post {
                if (generation != grantStatusGeneration || treeUri != uri) return@post
                grantStatusFuture = null
                refreshGrantStatus(status)
            }
        }
    }

    private fun invalidateGrantStatusRequests() {
        grantStatusGeneration += 1
        grantStatusFuture?.cancel(true)
        grantStatusFuture = null
    }

    private fun invalidatePendingIo(cancelSample: Boolean = true) {
        if (cancelSample) samplingGate.cancel()
        scanFence.invalidate()
        pendingCancellation?.cancel()
        pendingIoFuture?.cancel(true)
        pendingCancellation = null
        pendingIoFuture = null
        ioPending = false
    }

    private fun isCurrentIo(token: ScanToken, cancellation: CancellationSignal): Boolean =
        !cancellation.isCanceled && scanFence.accepts(token, treeUri?.toString())

    private fun finishPendingIo() {
        ioPending = false
        pendingCancellation = null
        pendingIoFuture = null
    }

    private fun currentGrantStatus(): GrantStatus = knownGrantStatus

    private fun syncSelectedUri(activeUri: String?) {
        treeUri = activeUri?.let(Uri::parse)
        if (activeUri == null) knownGrantStatus = GrantStatus.NOT_SELECTED
        getSharedPreferences(TREE_PREFS, MODE_PRIVATE).edit().apply {
            if (activeUri == null) remove(TREE_KEY) else putString(TREE_KEY, activeUri)
        }.apply()
    }

    private fun grantText(status: GrantStatus): String = when (status) {
        GrantStatus.GRANTED -> getString(R.string.grant_granted)
        GrantStatus.MISSING -> getString(R.string.grant_missing)
        GrantStatus.NOT_SELECTED -> getString(R.string.grant_not_selected)
        GrantStatus.ERROR -> getString(R.string.grant_error)
    }

    private fun statusText(status: ProviderStatus): String = when (status) {
        ProviderStatus.OK -> getString(R.string.result_saved)
        ProviderStatus.PERMISSION_DENIED -> getString(R.string.permission_denied)
        ProviderStatus.NOT_FOUND -> getString(R.string.not_found)
        ProviderStatus.INVALID_URI -> getString(R.string.invalid_uri)
        ProviderStatus.PROVIDER_ERROR -> getString(R.string.provider_error)
    }

    private fun updateActionState() {
        val hasGrant = treeUri != null && knownGrantStatus == GrantStatus.GRANTED
        scanButton.isEnabled = redactor != null && hasGrant && !sampling && !ioPending
        startButton.isEnabled = redactor != null && hasGrant && !sampling && !ioPending
        stopButton.isEnabled = sampling
        probeButton.isEnabled = redactor != null && hasGrant && selectedDocument != null && !sampling && !ioPending
        revokeButton.isEnabled = treeUri != null
    }

    private fun recordEvent(event: StoredObservation) {
        runCatching { store.append(event) }.onFailure {
            statusView.text = getString(R.string.report_error)
        }
    }

    private fun DocumentMetadata.toReportEntry(uri: Uri, probe: ReadProbeStatus? = null): ReportEntry? {
        val key = redactor ?: return null
        val documentKey = uri.toString() + "\u0000" + documentId
        val filenameKey = displayName ?: "<null>"
        return ReportEntry(
            id = key.fingerprint("document", documentKey),
            nameFingerprint = key.fingerprint("filename", filenameKey),
            size = size,
            lastModifiedEpochMs = lastModifiedEpochMs,
            readProbeStatus = probe,
        )
    }

    private fun probeStatusToProviderStatus(status: ReadProbeStatus): ProviderStatus = when (status) {
        ReadProbeStatus.READ_ONE_BYTE, ReadProbeStatus.EMPTY -> ProviderStatus.OK
        ReadProbeStatus.PERMISSION_DENIED -> ProviderStatus.PERMISSION_DENIED
        ReadProbeStatus.NOT_FOUND -> ProviderStatus.NOT_FOUND
        ReadProbeStatus.INVALID_URI -> ProviderStatus.INVALID_URI
        ReadProbeStatus.PROVIDER_ERROR -> ProviderStatus.PROVIDER_ERROR
    }

    private fun loadTreeUri(): Uri? = getSharedPreferences(TREE_PREFS, MODE_PRIVATE)
        .getString(TREE_KEY, null)
        ?.let(Uri::parse)

    private fun text(value: String, sizeSp: Float, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = sizeSp
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(8))
        setLineSpacing(0f, 1.15f)
    }

    private fun actionButton(resourceId: Int, action: () -> Unit): Button =
        actionButtonText(getString(resourceId), action)

    private fun actionButtonText(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 16f
        minHeight = dp(48)
        setAllCaps(false)
        setOnClickListener { action() }
        contentDescription = label
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(8) }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQUEST_TREE = 1001
        private const val REQUEST_EXPORT = 1002
        private const val SAMPLE_INTERVAL_MS = 2_000L
        private const val TREE_PREFS = "saf_spike_tree_private"
        private const val TREE_KEY = "selected_tree_uri"
    }
}
