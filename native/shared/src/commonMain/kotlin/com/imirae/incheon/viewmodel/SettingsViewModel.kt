package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.SettingsService
import com.imirae.incheon.domain.models.UserSettings
import com.imirae.incheon.domain.models.VoucherPrice
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsUiState(
    val isLoading: Boolean = true,
    val settings: UserSettings? = null,
    val voucherPrices: List<VoucherPrice> = emptyList(),
    val error: String? = null,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false
)

class SettingsViewModel(private val settingsService: SettingsService) {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadSettings() { scope.launch {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        when (val result = settingsService.getSettings()) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, settings = result.data)
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
        }
    }}

    fun updateSettings(settings: UserSettings) { scope.launch {
        _uiState.value = _uiState.value.copy(isSaving = true, saveSuccess = false)
        when (val result = settingsService.updateSettings(settings)) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(isSaving = false, saveSuccess = true, settings = result.data)
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isSaving = false, error = result.error.userMessage())
        }
    }}

    fun loadVoucherPrices() { scope.launch {
        when (val result = settingsService.getVoucherPrices()) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(voucherPrices = result.data)
            is ApiResult.Error -> {}
        }
    }}

    fun refresh() { loadSettings(); loadVoucherPrices() }
}
