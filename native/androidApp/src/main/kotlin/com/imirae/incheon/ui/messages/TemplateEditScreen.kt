package com.imirae.incheon.ui.messages

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.imirae.incheon.ui.components.AppTextField
import com.imirae.incheon.viewmodel.MessageTemplateViewModel

@Composable
fun TemplateEditScreen(viewModel: MessageTemplateViewModel, templateId: String, onNavigateBack: () -> Unit, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var initialized by remember { mutableStateOf(false) }

    LaunchedEffect(templateId) { viewModel.loadTemplate(templateId) }
    LaunchedEffect(uiState.selectedTemplate) {
        if (!initialized && uiState.selectedTemplate != null) {
            title = uiState.selectedTemplate!!.title; content = uiState.selectedTemplate!!.content; category = uiState.selectedTemplate!!.category ?: ""; initialized = true
        }
    }
    LaunchedEffect(uiState.saveSuccess) { if (uiState.saveSuccess) onNavigateBack() }
    LaunchedEffect(uiState.deleteSuccess) { if (uiState.deleteSuccess) onNavigateBack() }

    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("template-edit-screen"), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, "뒤로") }
            Text("템플릿 수정", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { viewModel.deleteTemplate(templateId) }, modifier = Modifier.testTag("template-edit-delete")) { Icon(Icons.Default.Delete, "삭제", tint = MaterialTheme.colorScheme.error) }
        }
        Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(2.dp)) {
            Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                AppTextField(value = title, onValueChange = { title = it }, label = "제목", testTag = "template-edit-title")
                AppTextField(value = content, onValueChange = { content = it }, label = "내용", singleLine = false, testTag = "template-edit-content")
                AppTextField(value = category, onValueChange = { category = it }, label = "카테고리", testTag = "template-edit-category")
            }
        }
        Button(onClick = { viewModel.updateTemplate(templateId, title, content, category.ifBlank { null }) }, enabled = !uiState.isSaving, modifier = Modifier.fillMaxWidth().height(48.dp).testTag("template-edit-submit"), shape = RoundedCornerShape(DesignTokens.Radius.md)) {
            if (uiState.isSaving) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp) else Text("저장", fontWeight = FontWeight.SemiBold)
        }
    }
}
