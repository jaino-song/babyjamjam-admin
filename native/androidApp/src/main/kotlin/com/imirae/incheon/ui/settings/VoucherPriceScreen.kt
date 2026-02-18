package com.imirae.incheon.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.SettingsViewModel

@Composable
fun VoucherPriceScreen(viewModel: SettingsViewModel, onNavigateBack: () -> Unit, modifier: Modifier = Modifier) {
    val uiState by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadVoucherPrices() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("voucher-price-screen")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack) { Icon(Icons.Default.ArrowBack, "뒤로") }
            Text("바우처 가격 관리", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("voucher-price-title"))
        }
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        when {
            uiState.isLoading -> LoadingScreen()
            uiState.voucherPrices.isEmpty() -> EmptyScreen("바우처 가격 정보가 없습니다")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
                items(uiState.voucherPrices) { price ->
                    Card(modifier = Modifier.fillMaxWidth().testTag("voucher-price-item"), shape = RoundedCornerShape(DesignTokens.Radius.md), elevation = CardDefaults.cardElevation(1.dp)) {
                        Row(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(price.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Text("${price.price}원", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }
}
