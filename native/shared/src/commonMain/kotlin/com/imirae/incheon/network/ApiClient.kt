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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json

interface TokenProvider {
    suspend fun getAccessToken(): String?
    suspend fun refreshToken(): String?
}

class ApiClient(
    private val baseUrl: String = "https://api.imirae-incheon.com",
    private val tokenProvider: TokenProvider? = null,
    val rateLimitHandler: RateLimitHandler = RateLimitHandler(),
) {
    val json = Json { ignoreUnknownKeys = true; isLenient = true; encodeDefaults = true }

    val httpClient = HttpClient(platformEngine()) {
        install(ContentNegotiation) { json(this@ApiClient.json) }
        install(Logging) { level = LogLevel.HEADERS }
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 10_000 }
        defaultRequest { url(baseUrl); contentType(ContentType.Application.Json) }
    }

    suspend inline fun <reified T> get(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.READ_HEAVY,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.get(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> post(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.post(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> put(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.put(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> delete(
        path: String,
        endpointCategory: EndpointCategory = if (path.startsWith("/auth")) EndpointCategory.AUTH else EndpointCategory.MUTATION,
        noinline block: HttpRequestBuilder.() -> Unit = {},
    ): ApiResult<T> = request(endpointCategory = endpointCategory) {
        httpClient.delete(path) {
            addAuth()
            block()
        }
    }

    suspend inline fun <reified T> request(
        endpointCategory: EndpointCategory,
        call: () -> HttpResponse,
    ): ApiResult<T> {
        var attempt = 0

        while (true) {
            try {
                val response = call()

                if (response.status.isSuccess()) {
                    return ApiResult.Success(response.body<T>())
                }

                val statusCode = response.status.value
                val retryPlan = rateLimitHandler.planRetry(
                    statusCode = statusCode,
                    attempt = attempt,
                    endpointCategory = endpointCategory,
                    retryAfterHeader = response.headers[HttpHeaders.RetryAfter],
                )

                if (retryPlan.shouldRetry) {
                    attempt += 1
                    delay(retryPlan.delayMillis)
                    continue
                }

                return ApiResult.Error(
                    ApiError.Http(
                        code = statusCode,
                        message = response.status.description,
                        body = runCatching { response.bodyAsText() }.getOrNull(),
                    )
                )
            } catch (e: CancellationException) {
                throw e
            } catch (_: HttpRequestTimeoutException) {
                return ApiResult.Error(ApiError.Timeout())
            } catch (_: ConnectTimeoutException) {
                return ApiResult.Error(ApiError.Timeout())
            } catch (_: SocketTimeoutException) {
                return ApiResult.Error(ApiError.Timeout())
            } catch (e: Exception) {
                return ApiResult.Error(ApiError.Unknown(e.message ?: "Unknown"))
            }
        }
    }

    suspend fun HttpRequestBuilder.addAuth() {
        tokenProvider?.getAccessToken()?.let { token ->
            header(HttpHeaders.Authorization, "Bearer $token")
        }
    }
}
