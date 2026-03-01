package com.imirae.incheon.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens

@Composable
fun StatusBadge(status: String, label: String, modifier: Modifier = Modifier) {
    val (bgColor, textColor) = when (status) {
        "active", "signed" -> Color(DesignTokens.Colors.success).copy(alpha = 0.15f) to Color(DesignTokens.Colors.success)
        "pending", "draft" -> Color(DesignTokens.Colors.warning).copy(alpha = 0.15f) to Color(DesignTokens.Colors.warning)
        "inactive", "rejected", "revoked" -> Color(DesignTokens.Colors.destructive).copy(alpha = 0.15f) to Color(DesignTokens.Colors.destructive)
        else -> Color(DesignTokens.Colors.muted).copy(alpha = 0.15f) to Color(DesignTokens.Colors.mutedForeground)
    }
    Surface(
        color = bgColor,
        shape = RoundedCornerShape(DesignTokens.Radius.sm),
        modifier = modifier.testTag("status-badge-$status")
    ) {
        Text(
            text = label,
            color = textColor,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}
