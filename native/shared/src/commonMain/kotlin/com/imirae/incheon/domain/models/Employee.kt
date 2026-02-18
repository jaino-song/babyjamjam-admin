package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class Employee(val id: String, val name: String, val phone: String? = null, val email: String? = null, val role: String = "caregiver", val status: String = "active", val organizationId: String? = null, val createdAt: String? = null, val updatedAt: String? = null)
@Serializable data class EmployeeListResponse(val data: List<Employee>, val total: Int, val page: Int, val limit: Int)
