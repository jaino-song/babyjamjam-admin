package com.imirae.incheon.network

import kotlinx.serialization.Serializable

sealed class ApiError {
    data class Http(val code: Int, val message: String, val body: String? = null) : ApiError()
    data class Network(val message: String) : ApiError()
    data class Timeout(val message: String = "요청 시간이 초과되었습니다") : ApiError()
    data class Serialization(val message: String) : ApiError()
    data class Unknown(val message: String) : ApiError()
    fun userMessage(): String = when (this) {
        is Http -> when (code) { 401->"인증이 만료되었습니다"; 403->"접근 권한이 없습니다"; 404->"요청한 정보를 찾을 수 없습니다"; 429->"요청이 너무 많습니다"; in 500..599->"서버 오류가 발생했습니다"; else->message }
        is Network -> "네트워크 연결을 확인해 주세요"
        is Timeout -> message; is Serialization -> "데이터 처리 중 오류"; is Unknown -> "알 수 없는 오류"
    }
}
@Serializable data class ApiErrorResponse(val message: String? = null, val statusCode: Int? = null, val error: String? = null)
