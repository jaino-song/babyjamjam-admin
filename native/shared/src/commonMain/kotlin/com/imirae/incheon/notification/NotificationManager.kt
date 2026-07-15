package com.imirae.incheon.notification

import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.deeplink.NavigationIntent
import com.imirae.incheon.data.remote.NotificationService
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Cross-platform notification manager.
 * Handles payload parsing, routing via DeepLinkRouter, and unread state.
 */

data class NotificationPayload(
    val title: String,
    val body: String,
    val deepLink: String? = null,
    val data: Map<String, String> = emptyMap()
)

data class NotificationState(
    val unreadCount: Int = 0,
    val isPermissionGranted: Boolean = false,
    val deviceToken: String? = null
)

class NotificationManager(
    private val deepLinkRouter: DeepLinkRouter,
    private val notificationService: NotificationService
) {
    private val _state = MutableStateFlow(NotificationState())
    val state: StateFlow<NotificationState> = _state.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * Parse notification payload and return navigation intent.
     */
    fun routeNotification(payload: NotificationPayload): NavigationIntent {
        val deepLink = payload.deepLink ?: payload.data["deepLink"] ?: payload.data["link"]
        return if (deepLink != null) {
            deepLinkRouter.route(deepLink)
        } else {
            NavigationIntent.Unknown
        }
    }

    /**
     * Register device token with backend.
     */
    fun registerToken(token: String, platform: String) {
        _state.value = _state.value.copy(deviceToken = token)
        scope.launch {
            notificationService.registerDeviceToken(token, platform)
        }
    }

    /**
     * Unregister device token (logout / unsubscribe).
     */
    fun unregisterToken() {
        val token = _state.value.deviceToken ?: return
        scope.launch {
            notificationService.unregisterDeviceToken(token)
            _state.value = _state.value.copy(deviceToken = null)
        }
    }

    /**
     * Update unread count from backend.
     */
    fun refreshUnreadCount() {
        scope.launch {
            when (val result = notificationService.getUnreadCount()) {
                is ApiResult.Success -> _state.value = _state.value.copy(unreadCount = result.data)
                is ApiResult.Error -> {} // silently ignore
            }
        }
    }

    /**
     * Mark notification as read.
     */
    fun markAsRead(notificationId: String) {
        scope.launch {
            notificationService.markAsRead(notificationId)
            refreshUnreadCount()
        }
    }

    fun updatePermissionStatus(granted: Boolean) {
        _state.value = _state.value.copy(isPermissionGranted = granted)
    }

    fun decrementUnread() {
        val current = _state.value.unreadCount
        if (current > 0) {
            _state.value = _state.value.copy(unreadCount = current - 1)
        }
    }
}
