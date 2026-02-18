package com.imirae.incheon.domain.utils

object StatusCodes {
    fun contractStatusLabel(status: String): String = when (status) {
        "draft" -> "초안"; "pending" -> "대기 중"; "sent" -> "발송됨"; "signed" -> "서명 완료"
        "rejected" -> "거절됨"; "revoked" -> "취소됨"; "completed" -> "완료"; "expired" -> "만료됨"
        else -> status
    }
    fun clientStatusLabel(status: String): String = when (status) {
        "active" -> "활성"; "inactive" -> "비활성"; "archived" -> "보관됨"; else -> status
    }
    fun employeeStatusLabel(status: String): String = when (status) {
        "active" -> "활성"; "inactive" -> "비활성"; "on_leave" -> "휴직"; else -> status
    }
}
