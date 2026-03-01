package com.imirae.incheon.ui.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.AdminViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminFeedbackScreen(
    viewModel: AdminViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadFeedback()
    }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("admin-feedback-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "관리자 피드백",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("admin-feedback-title")
                    )
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.loadFeedback() },
                        modifier = Modifier.testTag("admin-feedback-refresh-button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "피드백 새로고침")
                    }
                }
            )
        }
    ) { innerPadding ->
        when {
            uiState.isLoading -> LoadingScreen(modifier = Modifier.padding(innerPadding))
            uiState.error != null -> {
                ErrorScreen(
                    message = uiState.error ?: "피드백을 불러오지 못했습니다",
                    onRetry = { viewModel.loadFeedback() },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            uiState.feedbackItems.isEmpty() -> {
                EmptyScreen(
                    message = "피드백이 없습니다",
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag("admin-feedback-content"),
                    contentPadding = PaddingValues(DesignTokens.Spacing.lg.dp),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                ) {
                    itemsIndexed(uiState.feedbackItems) { index, feedback ->
                        Card(
                            shape = RoundedCornerShape(DesignTokens.Radius.md),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("admin-feedback-item-$index")
                        ) {
                            Text(
                                text = feedback,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(DesignTokens.Spacing.lg.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
