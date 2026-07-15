package com.imirae.incheon.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.imirae.incheon.design.DesignTokens

@Composable
fun AppSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String = "검색...",
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyMedium) },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = "검색") },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "지우기")
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        modifier = modifier.fillMaxWidth().testTag("search-bar")
    )
}
