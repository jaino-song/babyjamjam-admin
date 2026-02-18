package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.CreateClientRequest
import com.imirae.incheon.domain.utils.KoreanSearch
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ClientListUiState(
    val isLoading: Boolean = true,
    val clients: List<Client> = emptyList(),
    val filteredClients: List<Client> = emptyList(),
    val searchQuery: String = "",
    val statusFilter: String? = null,
    val currentPage: Int = 1,
    val totalPages: Int = 1,
    val totalCount: Int = 0,
    val error: String? = null,
    val isCreating: Boolean = false,
    val createSuccess: Boolean = false
)

class ClientListViewModel(private val clientService: ClientService) {
    private val _uiState = MutableStateFlow(ClientListUiState())
    val uiState: StateFlow<ClientListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val pageSize = 20

    fun loadClients(page: Int = 1) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = clientService.getClients(page = page, limit = pageSize)) {
                is ApiResult.Success -> {
                    val clients = result.data.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        clients = clients,
                        filteredClients = applyFilters(clients, _uiState.value.searchQuery, _uiState.value.statusFilter),
                        currentPage = page,
                        totalPages = (result.data.total + pageSize - 1) / pageSize,
                        totalCount = result.data.total
                    )
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
            }
        }
    }

    fun search(query: String) {
        _uiState.value = _uiState.value.copy(
            searchQuery = query,
            filteredClients = applyFilters(_uiState.value.clients, query, _uiState.value.statusFilter)
        )
    }

    fun filterByStatus(status: String?) {
        _uiState.value = _uiState.value.copy(
            statusFilter = status,
            filteredClients = applyFilters(_uiState.value.clients, _uiState.value.searchQuery, status)
        )
    }

    fun nextPage() { if (_uiState.value.currentPage < _uiState.value.totalPages) loadClients(_uiState.value.currentPage + 1) }
    fun previousPage() { if (_uiState.value.currentPage > 1) loadClients(_uiState.value.currentPage - 1) }
    fun refresh() = loadClients(_uiState.value.currentPage)

    fun createClient(request: CreateClientRequest) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isCreating = true, createSuccess = false)
            when (val result = clientService.createClient(request)) {
                is ApiResult.Success -> {
                    _uiState.value = _uiState.value.copy(isCreating = false, createSuccess = true)
                    loadClients(1)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isCreating = false, error = result.error.userMessage())
            }
        }
    }

    fun deleteClient(id: String) {
        scope.launch {
            when (clientService.deleteClient(id)) {
                is ApiResult.Success -> loadClients(_uiState.value.currentPage)
                is ApiResult.Error -> {}
            }
        }
    }

    private fun applyFilters(clients: List<Client>, query: String, status: String?): List<Client> {
        var filtered = clients
        if (query.isNotBlank()) {
            filtered = filtered.filter { client ->
                KoreanSearch.matchesKoreanSearch(query, client.name) ||
                client.phone?.contains(query) == true ||
                client.email?.contains(query, ignoreCase = true) == true
            }
        }
        if (status != null) {
            filtered = filtered.filter { it.status == status }
        }
        return filtered
    }
}
