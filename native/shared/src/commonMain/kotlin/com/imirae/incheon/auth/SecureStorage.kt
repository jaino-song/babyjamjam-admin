package com.imirae.incheon.auth
expect class SecureStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
    fun clear()
}
