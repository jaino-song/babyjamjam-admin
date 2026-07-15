package com.imirae.incheon.ui.chat

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.ChatMessage
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.ChatViewModel

private val ChatQuickActions = listOf("고객 찾기", "계약 상태 조회", "예약 확인")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var message by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) { viewModel.loadHistory() }

    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.lastIndex)
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("chat-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "AI 채팅",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("chat-title")
                    )
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.loadHistory() },
                        modifier = Modifier.testTag("chat-refresh-button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "채팅 새로고침")
                    }
                }
            )
        },
        bottomBar = {
            Surface(shadowElevation = 2.dp) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = DesignTokens.Spacing.lg.dp)
                        .padding(top = DesignTokens.Spacing.md.dp, bottom = DesignTokens.Spacing.lg.dp),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .testTag("chat-quick-actions"),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        ChatQuickActions.forEachIndexed { index, action ->
                            AssistChip(
                                onClick = {
                                    if (!uiState.isSending) {
                                        viewModel.sendMessage(action)
                                    }
                                },
                                label = { Text(action) },
                                enabled = !uiState.isSending,
                                modifier = Modifier.testTag("chat-quick-action-$index")
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        OutlinedTextField(
                            value = message,
                            onValueChange = { message = it },
                            placeholder = { Text("메시지를 입력하세요") },
                            modifier = Modifier
                                .weight(1f)
                                .testTag("chat-input"),
                            shape = RoundedCornerShape(DesignTokens.Radius.xl),
                            enabled = !uiState.isSending
                        )
                        FilledIconButton(
                            onClick = {
                                if (message.isNotBlank() && !uiState.isSending) {
                                    viewModel.sendMessage(message.trim())
                                    message = ""
                                }
                            },
                            enabled = message.isNotBlank() && !uiState.isSending,
                            modifier = Modifier.testTag("chat-send-button")
                        ) {
                            if (uiState.isSending) {
                                CircularProgressIndicator(
                                    modifier = Modifier.height(DesignTokens.Spacing.lg.dp),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Icon(Icons.Default.Send, contentDescription = "전송")
                            }
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        when {
            uiState.isLoading -> LoadingScreen(modifier = Modifier.padding(innerPadding))
            uiState.error != null && uiState.messages.isEmpty() -> {
                ErrorScreen(
                    message = uiState.error ?: "채팅을 불러오지 못했습니다",
                    onRetry = { viewModel.loadHistory() },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            uiState.messages.isEmpty() -> {
                EmptyScreen(
                    message = "대화를 시작해 보세요",
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                ) {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .testTag("chat-message-list"),
                        contentPadding = PaddingValues(DesignTokens.Spacing.lg.dp),
                        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        items(items = uiState.messages, key = { it.id }) { chatMessage ->
                            ChatMessageBubble(chatMessage = chatMessage)
                        }
                    }

                    if (uiState.error != null) {
                        Text(
                            text = uiState.error ?: "메시지 전송 중 오류가 발생했습니다",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = DesignTokens.Spacing.lg.dp)
                                .padding(bottom = DesignTokens.Spacing.sm.dp)
                                .testTag("chat-inline-error")
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatMessageBubble(chatMessage: ChatMessage) {
    val isUserMessage = chatMessage.role == "user"

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUserMessage) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            color = if (isUserMessage) {
                Color(DesignTokens.Colors.primary)
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
            shape = RoundedCornerShape(DesignTokens.Radius.lg),
            modifier = Modifier
                .widthIn(max = 320.dp)
                .testTag("chat-message-${chatMessage.id}")
        ) {
            Text(
                text = chatMessage.content,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isUserMessage) {
                    Color(DesignTokens.Colors.primaryForeground)
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.padding(DesignTokens.Spacing.md.dp)
            )
        }
    }
}
