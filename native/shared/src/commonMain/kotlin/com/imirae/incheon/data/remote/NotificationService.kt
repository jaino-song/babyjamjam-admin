package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*

interface NotificationService {
    suspend fun getNotifications(): ApiResult<List<Notification>>
    suspend fun markAsRead(id: String): ApiResult<Unit>
}

class NotificationServiceImpl(private val client: ApiClient) : NotificationService {
    override suspend fun getNotifications() = client.get<List<Notification>>("/notifications")
    override suspend fun markAsRead(id: String) = client.put<Unit>("/notifications/$id/read")
}
