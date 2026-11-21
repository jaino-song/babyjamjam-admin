plugins {
    id("com.android.application")
}

android {
    namespace = "com.babyjamjam.helper.safspike"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.babyjamjam.helper.safspike"
        minSdk = 37
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
