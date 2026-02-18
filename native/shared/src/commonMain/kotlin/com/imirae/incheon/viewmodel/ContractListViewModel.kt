package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.domain.models.Contract
import com.imirae.incheon.domain.models.CreateContractRequest
import com.imirae.incheon.domain.utils.KoreanSearch
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ContractListUiState(
    val isLoading: Boolean = true,
    val contracts: List<Contract> = emptyList(),
    val filteredContracts: List<Contract> = emptyList(),
    val searchQuery: String = "",
    val statusFilter: String? = null,
    val currentPage: Int = 1,
    val totalPages: Int = 1,
    val totalCount: Int = 0,
    val error: String? = null,
    val isCreating: Boolean = false,
    val createSuccess: Boolean = false
)

class ContractListViewModel(private val documentService: DocumentService) {
    private val _uiState = MutableStateFlow(ContractListUiState())
    val uiState: StateFlow<ContractListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val pageSize = 20

    fun loadContracts(page: Int = 1) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = documentService.getContracts(page = page, limit = pageSize)) {
                is ApiResult.Success -> {
                    val contracts = result.data.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        contracts = contracts,
                        filteredContracts = applyFilters(contracts, _uiState.value.searchQuery, _uiState.value.statusFilter),
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
            filteredContracts = applyFilters(_uiState.value.contracts, query, _uiState.value.statusFilter)
        )
    }

    fun filterByStatus(status: String?) {
        _uiState.value = _uiState.value.copy(
            statusFilter = status,
            filteredContracts = applyFilters(_uiState.value.contracts, _uiState.value.searchQuery, status)
        )
    }

    fun nextPage() { if (_uiState.value.currentPage < _uiState.value.totalPages) loadContracts(_uiState.value.currentPage + 1) }
    fun previousPage() { if (_uiState.value.currentPage > 1) loadContracts(_uiState.value.currentPage - 1) }
    fun refresh() = loadContracts(_uiState.value.currentPage)

    fun createContract(request: CreateContractRequest) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isCreating = true, createSuccess = false)
            when (val result = documentService.createContract(request)) {
                is ApiResult.Success -> {
                    _uiState.value = _uiState.value.copy(isCreating = false, createSuccess = true)
                    loadContracts(1)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isCreating = false, error = result.error.userMessage())
            }
        }
    }

    private fun applyFilters(contracts: List<Contract>, query: String, status: String?): List<Contract> {
        var filtered = contracts
        if (query.isNotBlank()) {
            filtered = filtered.filter { contract ->
                contract.clientName?.let { KoreanSearch.matchesKoreanSearch(query, it) } == true ||
                contract.employeeName?.let { KoreanSearch.matchesKoreanSearch(query, it) } == true
            }
        }
        if (status != null) {
            filtered = filtered.filter { it.status == status }
        }
        return filtered
    }
}
