package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*

interface FileService {
    suspend fun getFiles(): ApiResult<List<FileItem>>
    suspend fun getFile(id: String): ApiResult<FileItem>
    suspend fun deleteFile(id: String): ApiResult<Unit>
}

class FileServiceImpl(private val client: ApiClient) : FileService {
    override suspend fun getFiles() = client.get<List<FileItem>>("/files")
    override suspend fun getFile(id: String) = client.get<FileItem>("/files/$id")
    override suspend fun deleteFile(id: String) = client.delete<Unit>("/files/$id")
}
