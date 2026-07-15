package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.Validation
import com.imirae.incheon.viewmodel.AuthViewModel

@Composable
fun ResetPasswordScreen(
    viewModel: AuthViewModel,
    token: String,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier
) {
    val authState by viewModel.authState.collectAsState()
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var confirmPasswordError by remember { mutableStateOf<String?>(null) }
    var passwordVisible by remember { mutableStateOf(false) }
    var resetSuccess by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val isLoading = authState is AuthState.Loading

    val hasMinLength = password.length >= 8
    val hasUpperCase = password.any { it.isUpperCase() }
    val hasLowerCase = password.any { it.isLowerCase() }
    val hasDigit = password.any { it.isDigit() }

    fun validateAndSubmit() {
        val result = Validation.validatePasswordStrength(password)
        passwordError = result.errorMessage
        confirmPasswordError = if (password != confirmPassword) "비밀번호가 일치하지 않습니다" else null
        if (result.isValid && confirmPasswordError == null) {
            viewModel.resetPassword(token, password)
            resetSuccess = true
        }
    }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-reset-password-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                if (resetSuccess && authState is AuthState.Unauthenticated) {
                    Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
                    Text("비밀번호 변경 완료!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("새 비밀번호로 로그인해 주세요.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                    Button(onClick = onNavigateToLogin, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(DesignTokens.Radius.md.dp)) {
                        Text("로그인 페이지로 이동", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    Text("비밀번호 재설정", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.testTag("auth-reset-password-title"))
                    Text("새로운 비밀번호를 입력해 주세요.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

                    if (authState is AuthState.Error) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(DesignTokens.Radius.md.dp), modifier = Modifier.fillMaxWidth()) {
                            Text((authState as AuthState.Error).message, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(DesignTokens.Spacing.md.dp))
                        }
                    }

                    OutlinedTextField(
                        value = password, onValueChange = { password = it; passwordError = null },
                        label = { Text("새 비밀번호") }, leadingIcon = { Icon(Icons.Default.Lock, null) },
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
                            }
                        },
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        isError = passwordError != null, supportingText = passwordError?.let { { Text(it) } },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                        singleLine = true, enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth().testTag("auth-reset-password-field"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    )

                    if (password.isNotEmpty()) {
                        Column(modifier = Modifier.fillMaxWidth().padding(start = DesignTokens.Spacing.sm.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            PasswordReqRow("8자 이상", hasMinLength)
                            PasswordReqRow("대문자 포함", hasUpperCase)
                            PasswordReqRow("소문자 포함", hasLowerCase)
                            PasswordReqRow("숫자 포함", hasDigit)
                        }
                    }

                    OutlinedTextField(
                        value = confirmPassword, onValueChange = { confirmPassword = it; confirmPasswordError = null },
                        label = { Text("비밀번호 확인") }, leadingIcon = { Icon(Icons.Default.Lock, null) },
                        visualTransformation = PasswordVisualTransformation(),
                        isError = confirmPasswordError != null, supportingText = confirmPasswordError?.let { { Text(it) } },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); validateAndSubmit() }),
                        singleLine = true, enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth().testTag("auth-reset-password-confirm-field"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    )

                    Button(
                        onClick = { validateAndSubmit() }, enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-reset-password-submit-button"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    ) {
                        if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                        else Text("비밀번호 변경", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun PasswordReqRow(text: String, met: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.xs.dp)) {
        Icon(if (met) Icons.Default.CheckCircle else Icons.Default.Cancel, null, tint = if (met) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (met) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
