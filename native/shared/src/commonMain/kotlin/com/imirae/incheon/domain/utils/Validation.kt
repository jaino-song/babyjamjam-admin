package com.imirae.incheon.domain.utils

data class ValidationResult(val isValid: Boolean, val errorMessage: String? = null)

object Validation {
    private val emailRegex = Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
    private val koreanPhoneRegex = Regex("^010-\\d{4}-\\d{4}$")
    private val nameRegex = Regex("^[가-힣a-zA-Z]{2,50}$")

    fun validateRequired(value: String?, fieldName: String): ValidationResult {
        return if (value.isNullOrBlank()) ValidationResult(false, "$fieldName 을(를) 입력해 주세요") else ValidationResult(true)
    }
    fun validateEmail(email: String): ValidationResult {
        return if (email.isBlank()) ValidationResult(false, "이메일을 입력해 주세요")
        else if (!emailRegex.matches(email)) ValidationResult(false, "유효한 이메일 형식이 아닙니다")
        else ValidationResult(true)
    }
    fun validatePasswordStrength(password: String): ValidationResult {
        if (password.length < 8) return ValidationResult(false, "비밀번호는 8자 이상이어야 합니다")
        if (!password.any { it.isUpperCase() }) return ValidationResult(false, "대문자를 포함해야 합니다")
        if (!password.any { it.isLowerCase() }) return ValidationResult(false, "소문자를 포함해야 합니다")
        if (!password.any { it.isDigit() }) return ValidationResult(false, "숫자를 포함해야 합니다")
        return ValidationResult(true)
    }
    fun validateName(name: String): ValidationResult {
        return if (name.isBlank()) ValidationResult(false, "이름을 입력해 주세요")
        else if (!nameRegex.matches(name)) ValidationResult(false, "이름은 한글 또는 영문 2-50자여야 합니다")
        else ValidationResult(true)
    }
    fun validateKoreanPhoneNumber(phone: String): ValidationResult {
        return if (phone.isBlank()) ValidationResult(true) // optional
        else if (!koreanPhoneRegex.matches(phone)) ValidationResult(false, "전화번호 형식: 010-XXXX-XXXX")
        else ValidationResult(true)
    }
}
