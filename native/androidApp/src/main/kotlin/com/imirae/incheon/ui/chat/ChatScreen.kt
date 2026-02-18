package com.imirae.incheon.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.viewmodel.ChatViewModel

@Composable
fun ChatScreen(viewModel: ChatViewModel, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    var message by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) { viewModel.loadHistory() }
    LaunchedEffect(uiState.messages.size) { if (uiState.messages.isNotEmpty()) listState.animateScrollToItem(uiState.messages.size - 1) }

    Column(modifier = modifier.fillMaxSize().testTag("chat-screen")) {
        Text("AI 채팅", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(DesignTokens.Spacing.lg.dp).testTag("chat-title"))
        LazyColumn(state = listState, modifier = Modifier.weight(1f).padding(horizontal = DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
            items(uiState.messages) { msg ->
                val isUser = msg.role == "user"
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
                    Surface(color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(DesignTokens.Radius.lg), modifier = Modifier.widthIn(max = 280.dp).testTag("chat-message-${msg.id}")) {
                        Text(msg.content, style = MaterialTheme.typography.bodyMedium, color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(DesignTokens.Spacing.md.dp))
                    }
                }
            }
        }
        // Input
        Row(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
            OutlinedTextField(value = message, onValueChange = { message = it }, placeholder = { Text("메시지를 입력하세요...") }, modifier = Modifier.weight(1f).testTag("chat-input"), shape = RoundedCornerShape(DesignTokens.Radius.xl), singleLine = true, enabled = !uiState.isSending)
            IconButton(onClick = { if (message.isNotBlank()) { viewModel.sendMessage(message); message = "" } }, enabled = !uiState.isSending && message.isNotBlank(), modifier = Modifier.testTag("chat-send-button")) {
                if (uiState.isSending) CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp) else Icon(Icons.Default.Send, "전송", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
