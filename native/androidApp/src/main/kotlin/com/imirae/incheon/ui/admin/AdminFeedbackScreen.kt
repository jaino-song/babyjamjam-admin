package com.imirae.incheon.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.viewmodel.AdminViewModel
import androidx.compose.ui.unit.dp

@Composable
fun AdminFeedbackScreen(viewModel: AdminViewModel, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadFeedback() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("admin-feedback-screen")) {
        Text("관리자 피드백", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("admin-feedback-title"))
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        if (uiState.feedbackItems.isEmpty()) {
            EmptyScreen("피드백이 없습니다")
        }
    }
}
