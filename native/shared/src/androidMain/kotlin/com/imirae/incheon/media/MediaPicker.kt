package com.imirae.incheon.media

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Android MediaPicker implementation using CameraX and MediaStore.
 * Handles camera capture, gallery selection, image compression, and MIME validation.
 */
actual class MediaPicker(private val context: Context) {
    /**
     * Check if camera permission is granted.
     */
    actual fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Check if photo library permission is granted.
     */
    actual fun hasGalleryPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.READ_MEDIA_IMAGES
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Validate file against config constraints.
     */
    fun validateFile(mimeType: String, sizeBytes: Long, config: MediaPickerConfig): MediaPickerError? {
        if (mimeType !in config.allowedMimeTypes) {
            return MediaPickerError.InvalidMimeType(mimeType)
        }
        if (sizeBytes > config.maxSizeBytes) {
            return MediaPickerError.FileTooLarge(sizeBytes, config.maxSizeBytes)
        }
        return null
    }

    // TODO: Implement capturePhoto() using CameraX
    // TODO: Implement selectFromGallery() using ActivityResultContracts.PickVisualMedia
    // TODO: Implement compressImage() — JPEG quality 80%, max 2MB
}
