package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.Validation
import com.imirae.incheon.viewmodel.AuthViewModel

@Composable
fun ForgotPasswordScreen(
    viewModel: AuthViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val authState by viewModel.authState.collectAsState()
    var email by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }
    var emailSent by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val isLoading = authState is AuthState.Loading

    fun validateAndSubmit() {
        val result = Validation.validateEmail(email)
        emailError = result.errorMessage
        if (result.isValid) {
            viewModel.forgotPassword(email)
            emailSent = true
        }
    }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-forgot-password-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                // Back button
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("auth-forgot-password-back")) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                    Spacer(modifier = Modifier.weight(1f))
                }

                if (emailSent) {
                    // Success state
                    Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
                    Text("이메일 발송 완료", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "비밀번호 재설정 링크가 발송되었습니다.\n이메일을 확인해 주세요.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Button(
                        onClick = onNavigateBack,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    ) {
                        Text("로그인으로 돌아가기", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    Text("비밀번호 찾기", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.testTag("auth-forgot-password-title"))
                    Text(
                        "가입한 이메일 주소를 입력하시면\n비밀번호 재설정 링크를 보내드립니다.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )

                    OutlinedTextField(
                        value = email, onValueChange = { email = it; emailError = null },
                        label = { Text("이메일") }, leadingIcon = { Icon(Icons.Default.Email, null) },
                        isError = emailError != null, supportingText = emailError?.let { { Text(it) } },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); validateAndSubmit() }),
                        singleLine = true, enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth().testTag("auth-forgot-password-email-field"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    )

                    Button(
                        onClick = { validateAndSubmit() }, enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-forgot-password-submit-button"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    ) {
                        if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                        else Text("재설정 링크 발송", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }

                    Text(
                        "로그인으로 돌아가기",
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable(enabled = !isLoading) { onNavigateBack() }.testTag("auth-forgot-password-login-link")
                    )
                }
            }
        }
    }
}
