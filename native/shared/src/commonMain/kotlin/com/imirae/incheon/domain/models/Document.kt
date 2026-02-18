package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class Contract(val id: String, val clientId: String, val clientName: String? = null, val employeeId: String? = null, val employeeName: String? = null, val status: String = "draft", val startDate: String? = null, val endDate: String? = null, val serviceType: String? = null, val amount: Long? = null, val organizationId: String? = null, val createdAt: String? = null, val updatedAt: String? = null)
@Serializable data class ContractListResponse(val data: List<Contract>, val total: Int, val page: Int, val limit: Int)
@Serializable data class CreateContractRequest(val clientId: String, val employeeId: String? = null, val startDate: String, val endDate: String, val serviceType: String, val amount: Long? = null)
@Serializable data class FileItem(val id: String, val name: String, val url: String, val mimeType: String? = null, val size: Long? = null, val createdAt: String? = null)
