package com.imirae.incheon.network

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

interface TokenProvider { suspend fun getAccessToken(): String?; suspend fun refreshToken(): String? }

class ApiClient(private val baseUrl: String, private val tokenProvider: TokenProvider? = null) {
    val json = Json { ignoreUnknownKeys = true; isLenient = true; encodeDefaults = true }
    val httpClient = HttpClient(platformEngine()) {
        install(ContentNegotiation) { json(this@ApiClient.json) }
        install(Logging) { level = LogLevel.HEADERS }
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 10_000 }
        defaultRequest { url(baseUrl); contentType(ContentType.Application.Json) }
    }
    suspend inline fun <reified T> get(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): ApiResult<T> = request { httpClient.get(path) { addAuth(); block() } }
    suspend inline fun <reified T> post(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): ApiResult<T> = request { httpClient.post(path) { addAuth(); block() } }
    suspend inline fun <reified T> put(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): ApiResult<T> = request { httpClient.put(path) { addAuth(); block() } }
    suspend inline fun <reified T> delete(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): ApiResult<T> = request { httpClient.delete(path) { addAuth(); block() } }
    suspend inline fun <reified T> request(call: () -> HttpResponse): ApiResult<T> = try {
        val r = call(); if (r.status.isSuccess()) ApiResult.Success(r.body<T>()) else ApiResult.Error(ApiError.Http(r.status.value, r.status.description, try { r.bodyAsText() } catch (_: Exception) { null }))
    } catch (e: Exception) { ApiResult.Error(ApiError.Unknown(e.message ?: "Unknown")) }
    suspend fun HttpRequestBuilder.addAuth() { tokenProvider?.getAccessToken()?.let { header(HttpHeaders.Authorization, "Bearer $it") } }
}
