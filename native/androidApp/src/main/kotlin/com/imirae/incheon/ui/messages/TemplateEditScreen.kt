package com.imirae.incheon.ui.messages

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.AppTextField
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.MessageTemplateViewModel

private val TemplateEditVariableCandidates = listOf(
    "{{고객명}}",
    "{{서비스명}}",
    "{{예약일}}",
    "{{담당자명}}"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplateEditScreen(
    viewModel: MessageTemplateViewModel,
    templateId: String,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var title by rememberSaveable(templateId) { mutableStateOf("") }
    var content by rememberSaveable(templateId) { mutableStateOf("") }
    var category by rememberSaveable(templateId) { mutableStateOf("") }
    var initializedForTemplateId by rememberSaveable { mutableStateOf<String?>(null) }
    var showDeleteDialog by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(templateId) {
        viewModel.loadTemplate(templateId)
    }

    LaunchedEffect(uiState.selectedTemplate?.id) {
        val selectedTemplate = uiState.selectedTemplate
        if (selectedTemplate?.id == templateId && initializedForTemplateId != templateId) {
            title = selectedTemplate.title
            content = selectedTemplate.content
            category = selectedTemplate.category.orEmpty()
            initializedForTemplateId = templateId
        }
    }

    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            onNavigateBack()
        }
    }

    LaunchedEffect(uiState.deleteSuccess) {
        if (uiState.deleteSuccess) {
            onNavigateBack()
        }
    }

    val canSubmit = title.isNotBlank() && content.isNotBlank() && !uiState.isSaving
    val isInitialLoading = uiState.isLoading && initializedForTemplateId != templateId

    if (showDeleteDialog) {
        AlertDialog(
            modifier = Modifier.testTag("template-edit-delete-dialog"),
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("템플릿 삭제") },
            text = { Text("이 템플릿을 삭제하면 되돌릴 수 없습니다.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDialog = false
                        viewModel.deleteTemplate(templateId)
                    },
                    modifier = Modifier.testTag("template-edit-delete-confirm-button")
                ) {
                    Text("삭제", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDeleteDialog = false },
                    modifier = Modifier.testTag("template-edit-delete-cancel-button")
                ) {
                    Text("취소")
                }
            }
        )
    }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("template-edit-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "템플릿 수정",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("template-edit-header-title")
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("template-edit-back-button")
                    ) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { showDeleteDialog = true },
                        modifier = Modifier.testTag("template-edit-delete-button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = "템플릿 삭제",
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        when {
            isInitialLoading -> LoadingScreen(modifier = Modifier.padding(innerPadding))
            initializedForTemplateId != templateId && uiState.error != null -> {
                ErrorScreen(
                    message = uiState.error ?: "템플릿 정보를 불러오지 못했습니다",
                    onRetry = { viewModel.loadTemplate(templateId) },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            initializedForTemplateId != templateId -> {
                EmptyScreen(
                    message = "템플릿 정보를 찾을 수 없습니다",
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .verticalScroll(rememberScrollState())
                        .padding(DesignTokens.Spacing.lg.dp),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
                ) {
                    if (uiState.error != null) {
                        Surface(
                            modifier = Modifier.fillMaxWidth().testTag("template-edit-error"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md),
                            color = MaterialTheme.colorScheme.errorContainer
                        ) {
                            Text(
                                text = uiState.error ?: "저장 중 오류가 발생했습니다",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.padding(DesignTokens.Spacing.md.dp)
                            )
                        }
                    }

                    Card(
                        shape = RoundedCornerShape(DesignTokens.Radius.lg),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(DesignTokens.Spacing.lg.dp),
                            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
                        ) {
                            AppTextField(
                                value = title,
                                onValueChange = { title = it },
                                label = "제목",
                                testTag = "template-edit-title"
                            )
                            AppTextField(
                                value = content,
                                onValueChange = { content = it },
                                label = "내용",
                                singleLine = false,
                                testTag = "template-edit-content"
                            )
                            AppTextField(
                                value = category,
                                onValueChange = { category = it },
                                label = "카테고리",
                                testTag = "template-edit-category"
                            )
                        }
                    }

                    Text(
                        text = "변수 삽입",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .testTag("template-edit-variable-row"),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        TemplateEditVariableCandidates.forEachIndexed { index, variable ->
                            AssistChip(
                                onClick = {
                                    content = if (content.isBlank()) {
                                        variable
                                    } else {
                                        "$content $variable"
                                    }
                                },
                                label = { Text(variable) },
                                modifier = Modifier.testTag("template-edit-variable-$index")
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        OutlinedButton(
                            onClick = { showDeleteDialog = true },
                            modifier = Modifier
                                .weight(1f)
                                .height(DesignTokens.Spacing.xxxl.dp)
                                .testTag("template-edit-delete-outlined-button")
                        ) {
                            Text("삭제", color = MaterialTheme.colorScheme.error)
                        }

                        Button(
                            onClick = {
                                viewModel.updateTemplate(
                                    id = templateId,
                                    title = title,
                                    content = content,
                                    category = if (category.isBlank()) null else category
                                )
                            },
                            enabled = canSubmit,
                            modifier = Modifier
                                .weight(1f)
                                .height(DesignTokens.Spacing.xxxl.dp)
                                .testTag("template-edit-submit-button"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md)
                        ) {
                            if (uiState.isSaving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.height(DesignTokens.Spacing.xl.dp),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text("저장", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}
