package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface DocumentService {
    suspend fun getContracts(page: Int = 1, limit: Int = 20, search: String? = null): ApiResult<ContractListResponse>
    suspend fun getContract(id: String): ApiResult<Contract>
    suspend fun createContract(request: CreateContractRequest): ApiResult<Contract>
}

class DocumentServiceImpl(private val client: ApiClient) : DocumentService {
    override suspend fun getContracts(page: Int, limit: Int, search: String?) = client.get<ContractListResponse>("/contracts?page=$page&limit=$limit" + (search?.let { "&search=$it" } ?: ""))
    override suspend fun getContract(id: String) = client.get<Contract>("/contracts/$id")
    override suspend fun createContract(request: CreateContractRequest) = client.post<Contract>("/contracts") { setBody(request) }
}
