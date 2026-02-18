package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.Contract
import com.imirae.incheon.domain.models.CreateClientRequest
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ClientDetailUiState(
    val isLoading: Boolean = true,
    val client: Client? = null,
    val contracts: List<Contract> = emptyList(),
    val error: String? = null,
    val isEditing: Boolean = false,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val isDeleting: Boolean = false,
    val deleteSuccess: Boolean = false
)

class ClientDetailViewModel(
    private val clientService: ClientService,
    private val documentService: DocumentService
) {
    private val _uiState = MutableStateFlow(ClientDetailUiState())
    val uiState: StateFlow<ClientDetailUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadClient(clientId: String) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = clientService.getClient(clientId)) {
                is ApiResult.Success -> {
                    _uiState.value = _uiState.value.copy(isLoading = false, client = result.data)
                    loadClientContracts(clientId)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
            }
        }
    }

    private fun loadClientContracts(clientId: String) {
        scope.launch {
            when (val result = documentService.getContracts(page = 1, limit = 50, search = clientId)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(contracts = result.data.data.filter { it.clientId == clientId })
                is ApiResult.Error -> {} // Non-critical
            }
        }
    }

    fun startEditing() { _uiState.value = _uiState.value.copy(isEditing = true) }
    fun cancelEditing() { _uiState.value = _uiState.value.copy(isEditing = false) }

    fun updateClient(clientId: String, request: CreateClientRequest) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true, saveSuccess = false)
            when (val result = clientService.updateClient(clientId, request)) {
                is ApiResult.Success -> {
                    _uiState.value = _uiState.value.copy(isSaving = false, saveSuccess = true, isEditing = false, client = result.data)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isSaving = false, error = result.error.userMessage())
            }
        }
    }

    fun deleteClient(clientId: String) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isDeleting = true)
            when (clientService.deleteClient(clientId)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(isDeleting = false, deleteSuccess = true)
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isDeleting = false, error = "삭제에 실패했습니다")
            }
        }
    }

    fun refresh() { _uiState.value.client?.let { loadClient(it.id) } }
}
