package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.TemplateService
import com.imirae.incheon.domain.models.MessageTemplate
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MessageTemplateUiState(
    val isLoading: Boolean = true,
    val templates: List<MessageTemplate> = emptyList(),
    val selectedTemplate: MessageTemplate? = null,
    val error: String? = null,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val deleteSuccess: Boolean = false
)

class MessageTemplateViewModel(private val templateService: TemplateService) {
    private val _uiState = MutableStateFlow(MessageTemplateUiState())
    val uiState: StateFlow<MessageTemplateUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadTemplates() { scope.launch {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        when (val result = templateService.getMessageTemplates()) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, templates = result.data)
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
        }
    }}

    fun loadTemplate(id: String) { scope.launch {
        _uiState.value = _uiState.value.copy(isLoading = true)
        when (val result = templateService.getMessageTemplate(id)) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, selectedTemplate = result.data)
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
        }
    }}

    fun createTemplate(title: String, content: String, category: String?) { scope.launch {
        _uiState.value = _uiState.value.copy(isSaving = true, saveSuccess = false)
        when (val result = templateService.createMessageTemplate(title, content, category)) {
            is ApiResult.Success -> { _uiState.value = _uiState.value.copy(isSaving = false, saveSuccess = true); loadTemplates() }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isSaving = false, error = result.error.userMessage())
        }
    }}

    fun updateTemplate(id: String, title: String, content: String, category: String?) { scope.launch {
        _uiState.value = _uiState.value.copy(isSaving = true, saveSuccess = false)
        when (val result = templateService.updateMessageTemplate(id, title, content, category)) {
            is ApiResult.Success -> { _uiState.value = _uiState.value.copy(isSaving = false, saveSuccess = true, selectedTemplate = result.data); loadTemplates() }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isSaving = false, error = result.error.userMessage())
        }
    }}

    fun deleteTemplate(id: String) { scope.launch {
        when (templateService.deleteMessageTemplate(id)) {
            is ApiResult.Success -> { _uiState.value = _uiState.value.copy(deleteSuccess = true); loadTemplates() }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(error = "삭제에 실패했습니다")
        }
    }}

    fun refresh() = loadTemplates()
}
