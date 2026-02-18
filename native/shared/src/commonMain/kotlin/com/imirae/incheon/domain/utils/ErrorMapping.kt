package com.imirae.incheon.domain.utils

import com.imirae.incheon.network.ApiError

object ErrorMapping {
    fun toUserMessage(error: ApiError): String = error.userMessage()
}
