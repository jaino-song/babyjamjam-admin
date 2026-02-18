package com.imirae.incheon.ui.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.FileListViewModel

@Composable
fun FileListScreen(viewModel: FileListViewModel, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadFiles() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("file-list-screen")) {
        Text("파일 관리", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("file-list-title"))
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        when {
            uiState.isLoading -> LoadingScreen()
            uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
            uiState.files.isEmpty() -> EmptyScreen("파일이 없습니다")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
                items(uiState.files) { file ->
                    Card(modifier = Modifier.fillMaxWidth().clickable { /* TODO: open file */ }.testTag("file-item-${file.id}"), shape = RoundedCornerShape(DesignTokens.Radius.md), elevation = CardDefaults.cardElevation(1.dp)) {
                        Row(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                            Icon(Icons.Default.InsertDriveFile, null, tint = MaterialTheme.colorScheme.primary)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(file.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                file.mimeType?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            Icon(Icons.Default.Download, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}
