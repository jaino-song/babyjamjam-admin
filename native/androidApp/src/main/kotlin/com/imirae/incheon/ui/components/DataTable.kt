package com.imirae.incheon.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens

@Composable
fun <T> DataListItem(
    item: T,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    testTag: String = "",
    content: @Composable RowScope.(T) -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .testTag(testTag),
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier.padding(DesignTokens.Spacing.lg.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            content(item)
        }
    }
}

@Composable
fun PaginationControls(
    currentPage: Int,
    totalPages: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = onPrevious, enabled = currentPage > 1) { Text("이전") }
        Text("$currentPage / $totalPages", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp))
        TextButton(onClick = onNext, enabled = currentPage < totalPages) { Text("다음") }
    }
}
