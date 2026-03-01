package com.imirae.incheon.media

/**
 * iOS MediaPicker implementation using PHPickerViewController.
 * Handles photo library selection and camera capture via UIImagePickerController.
 */
actual class MediaPicker {
    /**
     * Check if camera permission is granted.
     * On iOS, camera permission is requested at first use.
     */
    actual fun hasCameraPermission(): Boolean {
        // iOS camera permission is checked via AVCaptureDevice.authorizationStatus
        // This is a simplified check — full implementation uses platform APIs via Swift bridge
        return true // Placeholder — actual check done in Swift layer
    }

    /**
     * Check if photo library permission is granted.
     * On iOS 14+, PHPicker doesn't require explicit permission for limited access.
     */
    actual fun hasGalleryPermission(): Boolean {
        // PHPicker on iOS 14+ provides limited access without explicit permission
        return true // Placeholder — PHPicker handles this automatically
    }

    // TODO: Implement via Swift bridge using PHPickerViewController
    // TODO: Implement camera capture via UIImagePickerController bridge
    // TODO: Implement image compression using UIImage.jpegData(compressionQuality:)
}
