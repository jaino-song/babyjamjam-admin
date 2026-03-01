package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.viewmodel.AuthViewModel

data class OrganizationItem(val id: String, val name: String, val role: String)

@Composable
fun SelectOrgScreen(
    viewModel: AuthViewModel,
    organizations: List<OrganizationItem>,
    onNavigateToDashboard: () -> Unit,
    modifier: Modifier = Modifier
) {
    val authState by viewModel.authState.collectAsState()
    val isLoading = authState is AuthState.Loading

    LaunchedEffect(authState) {
        if (authState is AuthState.Authenticated) {
            onNavigateToDashboard()
        }
    }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-select-org-card"),
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
                    Icons.Default.Business,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(48.dp)
                )

                Text(
                    "조직 선택",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.testTag("auth-select-org-title")
                )

                Text(
                    "사용할 조직을 선택해 주세요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                if (isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(32.dp))
                }

                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(organizations) { org ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !isLoading) { viewModel.selectOrganization(org.id) }
                                .testTag("auth-select-org-item-${org.id}"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                        ) {
                            Row(
                                modifier = Modifier.padding(DesignTokens.Spacing.lg.dp).fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(org.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                    Text(org.role, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
