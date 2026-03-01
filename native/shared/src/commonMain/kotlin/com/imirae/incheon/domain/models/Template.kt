package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class MessageTemplate(val id: String, val title: String, val content: String, val category: String? = null, val variables: List<String> = emptyList(), val organizationId: String? = null, val createdAt: String? = null, val updatedAt: String? = null)
@Serializable data class SystemTemplate(val id: String, val name: String, val content: String, val type: String, val createdAt: String? = null)
