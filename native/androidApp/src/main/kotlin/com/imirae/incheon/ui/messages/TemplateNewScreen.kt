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
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import com.imirae.incheon.viewmodel.MessageTemplateViewModel

private val TemplateVariableCandidates = listOf(
    "{{고객명}}",
    "{{서비스명}}",
    "{{예약일}}",
    "{{담당자명}}"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplateNewScreen(
    viewModel: MessageTemplateViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var title by rememberSaveable { mutableStateOf("") }
    var content by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            onNavigateBack()
        }
    }

    val canSubmit = title.isNotBlank() && content.isNotBlank() && !uiState.isSaving

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("template-new-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "템플릿 생성",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("template-new-header-title")
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("template-new-back-button")
                    ) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                }
            )
        }
    ) { innerPadding ->
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
                    modifier = Modifier.fillMaxWidth().testTag("template-new-error"),
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
                        label = "제목 *",
                        testTag = "template-new-title"
                    )
                    AppTextField(
                        value = content,
                        onValueChange = { content = it },
                        label = "내용 *",
                        singleLine = false,
                        testTag = "template-new-content"
                    )
                    AppTextField(
                        value = category,
                        onValueChange = { category = it },
                        label = "카테고리",
                        testTag = "template-new-category"
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
                    .testTag("template-new-variable-row"),
                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
            ) {
                TemplateVariableCandidates.forEachIndexed { index, variable ->
                    AssistChip(
                        onClick = {
                            content = if (content.isBlank()) {
                                variable
                            } else {
                                "$content $variable"
                            }
                        },
                        label = { Text(variable) },
                        modifier = Modifier.testTag("template-new-variable-$index")
                    )
                }
            }

            Button(
                onClick = {
                    viewModel.createTemplate(
                        title = title,
                        content = content,
                        category = if (category.isBlank()) null else category
                    )
                },
                enabled = canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(DesignTokens.Spacing.xxxl.dp)
                    .testTag("template-new-submit-button"),
                shape = RoundedCornerShape(DesignTokens.Radius.md)
            ) {
                if (uiState.isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(DesignTokens.Spacing.xl.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(text = "저장", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
