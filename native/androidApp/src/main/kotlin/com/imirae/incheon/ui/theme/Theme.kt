package com.imirae.incheon.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.imirae.incheon.design.DesignTokens

private fun Long.toColor() = Color(this)

private val LightColorScheme = lightColorScheme(
    primary = DesignTokens.Colors.primary.toColor(), onPrimary = Color.White,
    secondary = DesignTokens.Colors.secondary.toColor(), onSecondary = Color.White,
    background = DesignTokens.Colors.background.toColor(), onBackground = DesignTokens.Colors.foreground.toColor(),
    surface = DesignTokens.Colors.card.toColor(), onSurface = DesignTokens.Colors.foreground.toColor(),
    surfaceVariant = DesignTokens.Colors.muted.toColor(), onSurfaceVariant = DesignTokens.Colors.mutedForeground.toColor(),
    error = DesignTokens.Colors.destructive.toColor(), onError = Color.White,
    outline = DesignTokens.Colors.border.toColor(),
)

private val DarkColorScheme = darkColorScheme(
    primary = DesignTokens.Colors.primary.toColor(), onPrimary = Color.White,
    secondary = DesignTokens.Colors.secondary.toColor(), onSecondary = Color.White,
    background = DesignTokens.DarkColors.background.toColor(), onBackground = DesignTokens.DarkColors.foreground.toColor(),
    surface = DesignTokens.DarkColors.card.toColor(), onSurface = DesignTokens.DarkColors.foreground.toColor(),
    surfaceVariant = Color(0xFF2D2D2D), onSurfaceVariant = Color(0xFFA1A1AA),
    error = DesignTokens.Colors.destructive.toColor(), onError = Color.White,
    outline = DesignTokens.DarkColors.border.toColor(),
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(fontSize = DesignTokens.Typography.heading1.sp, fontWeight = FontWeight.Bold),
    headlineMedium = TextStyle(fontSize = DesignTokens.Typography.heading2.sp, fontWeight = FontWeight.Bold),
    headlineSmall = TextStyle(fontSize = DesignTokens.Typography.heading3.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = DesignTokens.Typography.heading4.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = DesignTokens.Typography.body.sp), bodyMedium = TextStyle(fontSize = DesignTokens.Typography.bodySmall.sp),
    bodySmall = TextStyle(fontSize = DesignTokens.Typography.caption.sp), labelLarge = TextStyle(fontSize = DesignTokens.Typography.label.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun ImiRaeTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme, typography = AppTypography, content = content)
}
