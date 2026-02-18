package com.imirae.incheon.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens

@Composable
fun SettingsScreen(onNavigateToVoucherPrices: () -> Unit, onLogout: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("settings-screen"), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
        Text("설정", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("settings-title"))
        SettingsItem(icon = Icons.Default.AttachMoney, title = "바우처 가격 관리", subtitle = "바우처 가격 정보를 관리합니다", onClick = onNavigateToVoucherPrices, tag = "settings-voucher-prices")
        SettingsItem(icon = Icons.Default.Notifications, title = "알림 설정", subtitle = "푸시 알림을 관리합니다", onClick = {}, tag = "settings-notifications")
        SettingsItem(icon = Icons.Default.Security, title = "보안", subtitle = "비밀번호 및 보안 설정", onClick = {}, tag = "settings-security")
        SettingsItem(icon = Icons.Default.Info, title = "앱 정보", subtitle = "버전 및 라이선스 정보", onClick = {}, tag = "settings-about")
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.xl.dp))
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().testTag("settings-logout"), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
            Icon(Icons.Default.Logout, null, modifier = Modifier.size(18.dp)); Spacer(modifier = Modifier.width(8.dp)); Text("로그아웃")
        }
    }
}

@Composable
private fun SettingsItem(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit, tag: String) {
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).testTag(tag), shape = RoundedCornerShape(DesignTokens.Radius.md), elevation = CardDefaults.cardElevation(1.dp)) {
        Row(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
