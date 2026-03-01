package com.imirae.incheon.ui.recording

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.recording.CallRecordingManager
import com.imirae.incheon.recording.RecordingFile
import com.imirae.incheon.ui.components.*

@Composable
fun RecordingListScreen(
    recordingManager: CallRecordingManager,
    onRequestFolderAccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by recordingManager.uiState.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(DesignTokens.Spacing.lg.dp)
            .testTag("recording-list-screen")
    ) {
        Text(
            "통화 녹음 관리",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.testTag("recording-list-title")
        )
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))

        when {
            !uiState.hasConsent -> {
                // Consent dialog
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(DesignTokens.Radius.lg),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
                    ) {
                        Icon(Icons.Default.Security, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
                        Text("개인정보 동의 필요", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            "통화 녹음 파일에 접근하려면 개인정보 처리에 대한 동의가 필요합니다. " +
                            "녹음 파일은 암호화되어 안전하게 전송되며, 업로드 후 기기에서 임시 파일이 삭제됩니다.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            onClick = { recordingManager.recordConsent("current-user") },
                            modifier = Modifier.fillMaxWidth().testTag("recording-consent-button"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md)
                        ) {
                            Text("동의하고 계속하기")
                        }
                    }
                }
            }
            !uiState.hasFolderAccess -> {
                // Folder access prompt
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(DesignTokens.Radius.lg),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
                    ) {
                        Icon(Icons.Default.Folder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
                        Text("녹음 폴더 선택", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            "통화 녹음이 저장된 폴더를 선택해주세요. 일반적으로 'Recordings' 또는 'Call' 폴더에 저장됩니다.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            onClick = onRequestFolderAccess,
                            modifier = Modifier.fillMaxWidth().testTag("recording-folder-button"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md)
                        ) {
                            Text("폴더 선택하기")
                        }
                    }
                }
            }
            uiState.isLoading -> LoadingScreen()
            uiState.recordings.isEmpty() -> EmptyScreen("녹음 파일이 없습니다")
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
                    items(uiState.recordings) { recording ->
                        RecordingItem(
                            recording = recording,
                            uploadProgress = uiState.uploadProgress[recording.uri],
                            onUpload = { recordingManager.uploadRecording(recording) }
                        )
                    }
                }
            }
        }

        uiState.error?.let { error ->
            Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun RecordingItem(
    recording: RecordingFile,
    uploadProgress: Float?,
    onUpload: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().testTag("recording-item-${recording.fileName}"),
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        elevation = CardDefaults.cardElevation(1.dp)
    ) {
        Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Mic, null, tint = MaterialTheme.colorScheme.primary)
                    Column {
                        Text(recording.fileName, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(
                            formatFileSize(recording.sizeBytes),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                when {
                    uploadProgress != null && uploadProgress < 1.0f -> {
                        CircularProgressIndicator(
                            progress = { uploadProgress },
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp
                        )
                    }
                    uploadProgress != null && uploadProgress >= 1.0f -> {
                        Icon(Icons.Default.CheckCircle, "업로드 완료", tint = MaterialTheme.colorScheme.primary)
                    }
                    else -> {
                        IconButton(onClick = onUpload) {
                            Icon(Icons.Default.CloudUpload, "업로드", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
            if (uploadProgress != null && uploadProgress < 1.0f) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { uploadProgress },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "${bytes}B"
        bytes < 1024 * 1024 -> "${bytes / 1024}KB"
        else -> "${bytes / (1024 * 1024)}MB"
    }
}
