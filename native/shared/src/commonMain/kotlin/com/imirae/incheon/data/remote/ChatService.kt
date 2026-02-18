package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface ChatService {
    suspend fun sendMessage(message: String, context: String? = null): ApiResult<ChatMessage>
    suspend fun getHistory(): ApiResult<List<ChatMessage>>
}

class ChatServiceImpl(private val client: ApiClient) : ChatService {
    override suspend fun sendMessage(message: String, context: String?) = client.post<ChatMessage>("/chat") { setBody(ChatRequest(message, context)) }
    override suspend fun getHistory() = client.get<List<ChatMessage>>("/chat/history")
}
