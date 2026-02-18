package com.imirae.incheon.auth

import platform.Foundation.*

/**
 * iOS SecureStorage using NSUserDefaults with keychain prefix.
 * TODO: Migrate to native Keychain via Swift bridge for production security.
 * The Swift layer (KeychainHelper) should handle Keychain access and be
 * called from here via a platform-specific bridge.
 */
actual class SecureStorage {
    private val defaults = NSUserDefaults(suiteName = "com.imirae.incheon.secure")

    actual fun getString(key: String): String? = defaults?.stringForKey(key)

    actual fun putString(key: String, value: String) {
        defaults?.setObject(value, forKey = key)
        defaults?.synchronize()
    }

    actual fun remove(key: String) {
        defaults?.removeObjectForKey(key)
        defaults?.synchronize()
    }

    actual fun clear() {
        defaults?.let { store ->
            store.dictionaryRepresentation().keys.forEach { key ->
                (key as? String)?.let { store.removeObjectForKey(it) }
            }
            store.synchronize()
        }
    }
}
