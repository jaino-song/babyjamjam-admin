package com.imirae.incheon.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
fun FilterChipRow(
    filters: List<Pair<String?, String>>,
    selectedFilter: String?,
    onFilterSelected: (String?) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        filters.forEach { (value, label) ->
            FilterChip(
                selected = selectedFilter == value,
                onClick = { onFilterSelected(if (selectedFilter == value) null else value) },
                label = { Text(label) },
                modifier = Modifier.testTag("filter-chip-${value ?: "all"}")
            )
        }
    }
}
