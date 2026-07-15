package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.setBody

interface NotificationService {
    suspend fun getNotifications(): ApiResult<List<Notification>>
    suspend fun markAsRead(id: String): ApiResult<Unit>
    suspend fun registerDeviceToken(token: String, platform: String): ApiResult<Unit>
    suspend fun unregisterDeviceToken(token: String): ApiResult<Unit>
    suspend fun getUnreadCount(): ApiResult<Int>
}

class NotificationServiceImpl(private val client: ApiClient) : NotificationService {
    override suspend fun getNotifications() = client.get<List<Notification>>("/notifications")
    override suspend fun markAsRead(id: String) = client.put<Unit>("/notifications/$id/read")
    override suspend fun registerDeviceToken(token: String, platform: String) = client.post<Unit>("/notifications/subscribe") { setBody(mapOf("token" to token, "platform" to platform)) }
    override suspend fun unregisterDeviceToken(token: String) = client.post<Unit>("/notifications/unsubscribe") { setBody(mapOf("token" to token)) }
    override suspend fun getUnreadCount() = client.get<Int>("/notifications/unread-count")
}
