package com.imirae.incheon.auth
import platform.Foundation.*
import platform.Security.*

actual class SecureStorage {
    actual fun getString(key: String): String? {
        val query = mapOf<Any?, Any?>(kSecClass to kSecClassGenericPassword, kSecAttrAccount to key, kSecReturnData to true, kSecMatchLimit to kSecMatchLimitOne)
        val result = arrayOf<Any?>(null)
        val status = SecItemCopyMatching(query as CFDictionaryRef, result)
        return if (status == errSecSuccess) (result[0] as? NSData)?.let { NSString.create(it, NSUTF8StringEncoding) as? String } else null
    }
    actual fun putString(key: String, value: String) {
        remove(key)
        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return
        val query = mapOf<Any?, Any?>(kSecClass to kSecClassGenericPassword, kSecAttrAccount to key, kSecValueData to data)
        SecItemAdd(query as CFDictionaryRef, null)
    }
    actual fun remove(key: String) {
        val query = mapOf<Any?, Any?>(kSecClass to kSecClassGenericPassword, kSecAttrAccount to key)
        SecItemDelete(query as CFDictionaryRef)
    }
    actual fun clear() { val query = mapOf<Any?, Any?>(kSecClass to kSecClassGenericPassword); SecItemDelete(query as CFDictionaryRef) }
}
