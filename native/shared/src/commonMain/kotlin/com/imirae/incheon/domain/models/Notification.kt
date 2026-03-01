package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class Notification(val id: String, val title: String, val body: String, val type: String, val read: Boolean = false, val data: Map<String, String>? = null, val createdAt: String? = null)
