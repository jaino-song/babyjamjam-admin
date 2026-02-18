package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class Client(val id: String, val name: String, val phone: String? = null, val email: String? = null, val address: String? = null, val memo: String? = null, val status: String = "active", val babyName: String? = null, val babyBirthDate: String? = null, val dueDate: String? = null, val organizationId: String? = null, val createdAt: String? = null, val updatedAt: String? = null)
@Serializable data class ClientListResponse(val data: List<Client>, val total: Int, val page: Int, val limit: Int)
@Serializable data class CreateClientRequest(val name: String, val phone: String? = null, val email: String? = null, val address: String? = null, val memo: String? = null, val babyName: String? = null, val babyBirthDate: String? = null, val dueDate: String? = null)
