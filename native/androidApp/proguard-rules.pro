# ProGuard/R8 rules for 이미래 인천 Android app

# Keep Kotlin serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.imirae.incheon.**$$serializer { *; }
-keepclassmembers class com.imirae.incheon.** { *** Companion; }
-keepclasseswithmembers class com.imirae.incheon.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep Ktor client
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
-keep class kotlinx.coroutines.** { *; }

# Keep Koin DI
-keep class org.koin.** { *; }
-dontwarn org.koin.**

# Keep domain models (serialization)
-keep class com.imirae.incheon.domain.models.** { *; }
-keep class com.imirae.incheon.network.** { *; }
-keep class com.imirae.incheon.auth.** { *; }

# Keep ViewModels
-keep class com.imirae.incheon.viewmodel.** { *; }

# Keep deep link router
-keep class com.imirae.incheon.deeplink.** { *; }

# Keep notification classes
-keep class com.imirae.incheon.notification.** { *; }

# Suppress warnings for missing classes in dependencies
-dontwarn org.slf4j.**
-dontwarn org.bouncycastle.**
