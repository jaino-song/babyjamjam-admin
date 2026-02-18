package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imirae.incheon.design.DesignTokens

@Composable
fun VerifyEmailScreen(
    onNavigateToLogin: () -> Unit,
    onResendVerification: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var email by remember { mutableStateOf("") }
    var resendSent by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-verify-email-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                Icon(
                    Icons.Default.MarkEmailRead,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(64.dp)
                )

                Text(
                    "이메일 인증",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.testTag("auth-verify-email-title")
                )

                Text(
                    "가입 시 입력한 이메일로 인증 링크가 발송되었습니다.\n이메일을 확인하여 계정을 활성화해 주세요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                HorizontalDivider()

                Text(
                    "인증 이메일을 받지 못하셨나요?",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it; resendSent = false },
                    label = { Text("이메일 주소") },
                    leadingIcon = { Icon(Icons.Default.Email, null) },
                    singleLine = true,
                    enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-verify-email-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                if (resendSent) {
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            "인증 이메일이 재발송되었습니다.",
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(DesignTokens.Spacing.md.dp),
                            textAlign = TextAlign.Center
                        )
                    }
                }

                OutlinedButton(
                    onClick = {
                        if (email.isNotBlank()) {
                            isLoading = true
                            onResendVerification(email)
                            resendSent = true
                            isLoading = false
                        }
                    },
                    enabled = !isLoading && email.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-verify-email-resend-button"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                ) {
                    Text("인증 이메일 재발송", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }

                Button(
                    onClick = onNavigateToLogin,
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-verify-email-login-button"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                ) {
                    Text("로그인 페이지로 이동", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
