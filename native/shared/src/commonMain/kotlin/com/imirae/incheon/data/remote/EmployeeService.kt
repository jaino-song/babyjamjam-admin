package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*

interface EmployeeService {
    suspend fun getEmployees(page: Int = 1, limit: Int = 20, search: String? = null): ApiResult<EmployeeListResponse>
    suspend fun getEmployee(id: String): ApiResult<Employee>
}

class EmployeeServiceImpl(private val client: ApiClient) : EmployeeService {
    override suspend fun getEmployees(page: Int, limit: Int, search: String?) = client.get<EmployeeListResponse>("/employees?page=$page&limit=$limit" + (search?.let { "&search=$it" } ?: ""))
    override suspend fun getEmployee(id: String) = client.get<Employee>("/employees/$id")
}
