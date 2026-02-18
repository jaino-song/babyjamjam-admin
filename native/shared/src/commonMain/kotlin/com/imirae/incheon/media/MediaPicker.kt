package com.imirae.incheon.media

/**
 * Cross-platform media picker interface.
 * Supports camera capture and gallery selection with compression.
 */

data class MediaPickerResult(
    val uri: String,
    val mimeType: String,
    val fileName: String,
    val sizeBytes: Long
)

data class MediaPickerConfig(
    val maxSizeBytes: Long = 10 * 1024 * 1024, // 10MB
    val compressionQuality: Int = 80,           // JPEG quality 0-100
    val maxCompressedSizeBytes: Long = 2 * 1024 * 1024, // 2MB after compression
    val allowedMimeTypes: Set<String> = setOf("image/jpeg", "image/png", "image/heic")
)

sealed class MediaPickerError {
    data object PermissionDenied : MediaPickerError()
    data object Cancelled : MediaPickerError()
    data class FileTooLarge(val sizeBytes: Long, val maxBytes: Long) : MediaPickerError()
    data class InvalidMimeType(val mimeType: String) : MediaPickerError()
    data class Unknown(val message: String) : MediaPickerError()
}

expect class MediaPicker {
    /**
     * Check if camera permission is granted.
     */
    fun hasCameraPermission(): Boolean

    /**
     * Check if photo library permission is granted.
     */
    fun hasGalleryPermission(): Boolean
}
