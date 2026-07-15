package com.imirae.incheon.ui.contracts

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.StatusCodes
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.ContractListViewModel

@Composable
fun ContractListScreen(
    viewModel: ContractListViewModel,
    onNavigateToDetail: (String) -> Unit,
    onNavigateToCreate: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadContracts() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("contract-list-screen")) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("계약 관리", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("contract-list-title"))
            FloatingActionButton(onClick = onNavigateToCreate, modifier = Modifier.testTag("contract-list-add-button")) {
                Icon(Icons.Default.Add, contentDescription = "계약 생성")
            }
        }
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        AppSearchBar(query = uiState.searchQuery, onQueryChange = { viewModel.search(it) }, placeholder = "계약 검색...")
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
        FilterChipRow(
            filters = listOf(null to "전체", "active" to "활성", "signed" to "서명완료", "pending" to "대기", "draft" to "초안", "rejected" to "거절"),
            selectedFilter = uiState.statusFilter,
            onFilterSelected = { viewModel.filterByStatus(it) }
        )
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
        Text("총 ${uiState.totalCount}건", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

        when {
            uiState.isLoading -> LoadingScreen()
            uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
            uiState.filteredContracts.isEmpty() -> EmptyScreen("계약이 없습니다")
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp), modifier = Modifier.weight(1f)) {
                    items(uiState.filteredContracts) { contract ->
                        DataListItem(item = contract, onClick = { onNavigateToDetail(contract.id) }, testTag = "contract-item-${contract.id}") {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(it.clientName ?: "고객", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                Text("${it.startDate ?: ""} ~ ${it.endDate ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                it.serviceType?.let { st -> Text(st, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            StatusBadge(status = it.status, label = StatusCodes.getStatusLabel(it.status))
                            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                PaginationControls(uiState.currentPage, uiState.totalPages, onPrevious = { viewModel.previousPage() }, onNext = { viewModel.nextPage() })
            }
        }
    }
}
