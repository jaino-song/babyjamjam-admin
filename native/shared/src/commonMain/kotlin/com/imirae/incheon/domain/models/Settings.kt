package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class UserSettings(val notifications: Boolean = true, val language: String = "ko", val theme: String = "system")
@Serializable data class VoucherPrice(val id: String, val serviceType: String, val price: Long, val description: String? = null)
