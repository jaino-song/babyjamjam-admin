package com.imirae.incheon.viewmodel

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AdminUiState(
    val isLoading: Boolean = false,
    val feedbackItems: List<String> = emptyList(),
    val error: String? = null
)

class AdminViewModel {
    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState: StateFlow<AdminUiState> = _uiState.asStateFlow()

    fun loadFeedback() {
        _uiState.value = _uiState.value.copy(isLoading = false, feedbackItems = emptyList())
    }
}
