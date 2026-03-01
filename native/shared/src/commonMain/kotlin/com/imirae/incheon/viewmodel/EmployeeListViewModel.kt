package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.utils.KoreanSearch
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class EmployeeListUiState(
    val isLoading: Boolean = true,
    val employees: List<Employee> = emptyList(),
    val filteredEmployees: List<Employee> = emptyList(),
    val searchQuery: String = "",
    val statusFilter: String? = null,
    val currentPage: Int = 1,
    val totalPages: Int = 1,
    val totalCount: Int = 0,
    val error: String? = null
)

class EmployeeListViewModel(private val employeeService: EmployeeService) {
    private val _uiState = MutableStateFlow(EmployeeListUiState())
    val uiState: StateFlow<EmployeeListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val pageSize = 20

    fun loadEmployees(page: Int = 1) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = employeeService.getEmployees(page = page, limit = pageSize)) {
                is ApiResult.Success -> {
                    val employees = result.data.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        employees = employees,
                        filteredEmployees = applyFilters(employees, _uiState.value.searchQuery, _uiState.value.statusFilter),
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
            filteredEmployees = applyFilters(_uiState.value.employees, query, _uiState.value.statusFilter)
        )
    }

    fun filterByStatus(status: String?) {
        _uiState.value = _uiState.value.copy(
            statusFilter = status,
            filteredEmployees = applyFilters(_uiState.value.employees, _uiState.value.searchQuery, status)
        )
    }

    fun nextPage() { if (_uiState.value.currentPage < _uiState.value.totalPages) loadEmployees(_uiState.value.currentPage + 1) }
    fun previousPage() { if (_uiState.value.currentPage > 1) loadEmployees(_uiState.value.currentPage - 1) }
    fun refresh() = loadEmployees(_uiState.value.currentPage)

    private fun applyFilters(employees: List<Employee>, query: String, status: String?): List<Employee> {
        var filtered = employees
        if (query.isNotBlank()) {
            filtered = filtered.filter { emp ->
                KoreanSearch.matchesChosung(query, emp.name) ||
                emp.phone?.contains(query) == true ||
                emp.email?.contains(query, ignoreCase = true) == true
            }
        }
        if (status != null) {
            filtered = filtered.filter { it.status == status }
        }
        return filtered
    }
}
