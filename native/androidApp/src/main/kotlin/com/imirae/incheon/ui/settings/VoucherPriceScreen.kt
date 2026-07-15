package com.imirae.incheon.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.VoucherPrice
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoucherPriceScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadVoucherPrices()
    }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("voucher-price-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "바우처 가격 관리",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("voucher-price-title")
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("voucher-price-back-button")
                    ) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.loadVoucherPrices() },
                        modifier = Modifier.testTag("voucher-price-refresh-button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "가격 새로고침")
                    }
                }
            )
        }
    ) { innerPadding ->
        when {
            uiState.isLoading && uiState.voucherPrices.isEmpty() -> {
                LoadingScreen(modifier = Modifier.padding(innerPadding))
            }

            uiState.error != null && uiState.voucherPrices.isEmpty() -> {
                ErrorScreen(
                    message = uiState.error ?: "바우처 가격 정보를 불러오지 못했습니다",
                    onRetry = { viewModel.loadVoucherPrices() },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            uiState.voucherPrices.isEmpty() -> {
                EmptyScreen(
                    message = "바우처 가격 정보가 없습니다",
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag("voucher-price-content"),
                    contentPadding = PaddingValues(DesignTokens.Spacing.lg.dp),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                ) {
                    items(items = uiState.voucherPrices, key = { it.id }) { price ->
                        VoucherPriceItem(price = price)
                    }
                }
            }
        }
    }
}

@Composable
private fun VoucherPriceItem(price: VoucherPrice) {
    Card(
        modifier = Modifier.fillMaxWidth().testTag("voucher-price-item-${price.id}"),
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(DesignTokens.Spacing.lg.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = price.serviceType,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "${price.price}원",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }

        if (!price.description.isNullOrBlank()) {
            Text(
                text = price.description ?: "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = DesignTokens.Spacing.lg.dp)
                    .padding(bottom = DesignTokens.Spacing.lg.dp)
            )
        }
    }
}
