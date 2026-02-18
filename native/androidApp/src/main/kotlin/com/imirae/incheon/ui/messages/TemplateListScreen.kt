package com.imirae.incheon.ui.messages

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.MessageTemplateViewModel

@Composable
fun TemplateListScreen(viewModel: MessageTemplateViewModel, onNavigateToNew: () -> Unit, onNavigateToEdit: (String) -> Unit, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadTemplates() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("template-list-screen")) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("메시지 템플릿", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            FloatingActionButton(onClick = onNavigateToNew, modifier = Modifier.testTag("template-list-add")) { Icon(Icons.Default.Add, "추가") }
        }
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        when {
            uiState.isLoading -> LoadingScreen()
            uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
            uiState.templates.isEmpty() -> EmptyScreen("템플릿이 없습니다")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
                items(uiState.templates) { template ->
                    Card(modifier = Modifier.fillMaxWidth().clickable { onNavigateToEdit(template.id) }.testTag("template-item-${template.id}"), shape = RoundedCornerShape(DesignTokens.Radius.md), elevation = CardDefaults.cardElevation(1.dp)) {
                        Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp)) {
                            Text(template.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(template.content, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}
