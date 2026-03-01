package com.imirae.incheon.network

sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val error: ApiError) : ApiResult<Nothing>()
    fun <R> map(transform: (T) -> R): ApiResult<R> = when (this) { is Success -> Success(transform(data)); is Error -> this }
    inline fun onSuccess(action: (T) -> Unit): ApiResult<T> { if (this is Success) action(data); return this }
    inline fun onError(action: (ApiError) -> Unit): ApiResult<T> { if (this is Error) action(error); return this }
    fun getOrNull(): T? = (this as? Success)?.data
}
