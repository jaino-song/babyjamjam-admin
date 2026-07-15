package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class ChatMessage(val id: String, val role: String, val content: String, val createdAt: String? = null)
@Serializable data class ChatRequest(val message: String, val context: String? = null)
