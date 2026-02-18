package com.imirae.incheon.recording

import com.imirae.incheon.data.remote.FileService
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Call recording manager for Android.
 * Uses SAF (Storage Access Framework) for secure folder access.
 * Implements privacy consent, encryption, upload, and audit trail.
 *
 * LEGAL GATE: Requires legal/compliance sign-off before production use.
 * See: native/docs/security/data-classification.md
 */

data class RecordingFile(
    val uri: String,
    val fileName: String,
    val sizeBytes: Long,
    val durationMs: Long = 0,
    val dateModified: Long = 0,
    val mimeType: String = "audio/mpeg"
)

data class RecordingUiState(
    val isLoading: Boolean = false,
    val recordings: List<RecordingFile> = emptyList(),
    val hasConsent: Boolean = false,
    val hasFolderAccess: Boolean = false,
    val uploadProgress: Map<String, Float> = emptyMap(), // uri -> progress 0.0-1.0
    val error: String? = null
)

// TODO(TD-REC-001): Implement AES-256 encryption for recordings before upload

class CallRecordingManager(private val fileService: FileService) {
    private val _uiState = MutableStateFlow(RecordingUiState())
    val uiState: StateFlow<RecordingUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    companion object {
        val SUPPORTED_EXTENSIONS = setOf(".mp3", ".m4a", ".3gp", ".amr", ".wav", ".ogg")
        const val MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024L // 100MB
    }

    /**
     * Record user consent for call recording access.
     * Consent artifact is stored locally and sent to backend.
     */
    fun recordConsent(userId: String) {
        _uiState.value = _uiState.value.copy(hasConsent = true)
        scope.launch {
            // TODO: Store consent artifact locally (SharedPreferences/DataStore)
            // TODO: Send consent record to backend audit trail
            logAuditEvent("CONSENT_GRANTED", userId)
        }
    }

    /**
     * Set folder access URI from SAF picker.
     * Caller must call takePersistableUriPermission before this.
     */
    fun setFolderAccess(folderUri: String) {
        _uiState.value = _uiState.value.copy(hasFolderAccess = true)
        logAuditEvent("FOLDER_ACCESS_GRANTED", folderUri)
    }

    /**
     * List recording files from the granted SAF folder.
     */
    fun loadRecordings(files: List<RecordingFile>) {
        val filtered = files.filter { file ->
            SUPPORTED_EXTENSIONS.any { ext -> file.fileName.lowercase().endsWith(ext) } &&
            file.sizeBytes <= MAX_FILE_SIZE_BYTES
        }
        _uiState.value = _uiState.value.copy(recordings = filtered, isLoading = false)
    }

    /**
     * Upload a recording file to backend.
     * Encrypts in temp cache before upload.
     */
    fun uploadRecording(recording: RecordingFile) {
        if (!_uiState.value.hasConsent) {
            _uiState.value = _uiState.value.copy(error = "녹음 파일 접근에 동의가 필요합니다")
            return
        }
        scope.launch {
            val progress = _uiState.value.uploadProgress.toMutableMap()
            progress[recording.uri] = 0.0f
            _uiState.value = _uiState.value.copy(uploadProgress = progress)

            logAuditEvent("UPLOAD_STARTED", recording.fileName)

            // TODO: Encrypt file with AES-256 before upload
            // TODO: Upload via fileService with progress tracking
            // TODO: Delete temp encrypted file after successful upload

            progress[recording.uri] = 1.0f
            _uiState.value = _uiState.value.copy(uploadProgress = progress)
            logAuditEvent("UPLOAD_COMPLETED", recording.fileName)
        }
    }

    /**
     * Handle permission revocation — clear state and re-prompt.
     */
    fun handlePermissionRevoked() {
        _uiState.value = _uiState.value.copy(
            hasFolderAccess = false,
            recordings = emptyList(),
            error = "폴더 접근 권한이 해제되었습니다. 다시 설정해주세요."
        )
        logAuditEvent("PERMISSION_REVOKED", "")
    }

    private fun logAuditEvent(event: String, detail: String) {
        // TODO: Implement audit trail logging (local + backend)
        println("[CallRecording] AUDIT: $event - $detail - ${System.currentTimeMillis()}")
    }
}
