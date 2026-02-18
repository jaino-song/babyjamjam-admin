# 이미래 인천 (imirae-incheon) — Native App Setup Guide

> Step-by-step instructions to build and run the Android and iOS apps.

---

## Prerequisites

### 1. Install Java 17 (required for Android + KMP)

```bash
brew install openjdk@17

# Add to your shell profile (~/.zshrc):
export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo "/opt/homebrew/opt/openjdk@17")
export PATH="$JAVA_HOME/bin:$PATH"

# Reload:
source ~/.zshrc

# Verify:
java -version  # Should show 17.x
```

### 2. Install Android Studio

1. Download from https://developer.android.com/studio
2. Open the `.dmg` and drag to Applications
3. Launch Android Studio
4. **First-time setup wizard**:
   - Choose "Standard" installation
   - Accept all SDK license agreements
   - Let it download Android SDK 35, build tools, emulator
5. After setup, go to **Settings → Languages & Frameworks → Android SDK**:
   - SDK Platforms tab: verify **Android 15 (API 35)** is checked
   - SDK Tools tab: check **Android SDK Build-Tools**, **Android Emulator**, **Android SDK Platform-Tools**

6. Set `ANDROID_HOME` in `~/.zshrc`:
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$PATH"
```

### 3. Install Xcode (required for iOS)

1. Open **App Store** → Search "Xcode" → Install (it's ~12 GB)
2. After install, open Xcode once to accept license and install components
3. Verify:
```bash
xcodebuild -version  # Should show Xcode 16.x
```

### 4. Install CocoaPods (optional, for iOS dependencies)

```bash
brew install cocoapods
```

---

## Part A: Android App — Android Studio

### Step 1: Generate Gradle Wrapper

```bash
cd native/

# Option A: If you have gradle installed globally
gradle wrapper --gradle-version 8.5

# Option B: If you don't have gradle, use Android Studio (see Step 2)
```

> If you skip this step, Android Studio will offer to generate the wrapper when you open the project.

### Step 2: Open Project in Android Studio

1. Open Android Studio
2. Click **"Open"** (not "New Project")
3. Navigate to `/Users/jaino/Development/dev/native/` and select the `native` folder
4. Click **"Open"**
5. Android Studio will detect the Gradle project and start syncing

### Step 3: Wait for Gradle Sync

- Bottom bar will show "Gradle sync" progress
- First time takes 5-10 minutes (downloads all dependencies)
- If it asks to install missing SDK components, click **"Install"**
- If it asks about Gradle wrapper, click **"OK"** to generate it

**If sync fails:**
- Check **File → Project Structure → SDK Location** — ensure Android SDK path is set
- Check **File → Settings → Build → Gradle** — ensure JDK 17 is selected
- Try **File → Invalidate Caches / Restart**

### Step 4: Create an Android Emulator

1. Click **Tools → Device Manager** (or the phone icon in the toolbar)
2. Click **"Create Virtual Device"**
3. Select **Pixel 7** (or any phone) → **Next**
4. Select **API 35** system image → **Download** if needed → **Next**
5. Name it anything → **Finish**
6. Click the **▶ Play** button next to the device to launch it

### Step 5: Run the App

1. In the top toolbar, select:
   - **Module**: `androidApp` (dropdown next to the green play button)
   - **Device**: Your emulator (e.g., "Pixel 7 API 35")
2. Click the **▶ Run** button (or press `Ctrl+R` / `⌃R`)
3. Wait for build (first build takes 2-3 minutes)
4. The app should launch on the emulator showing the login screen

### Step 6: Firebase Setup (for Push Notifications)

> Push notifications won't work without this. You can skip for initial testing.

1. Go to https://console.firebase.google.com/
2. Create a project (or use existing)
3. Add an Android app with package name: `com.imirae.incheon`
4. Download `google-services.json`
5. Place it in `native/androidApp/google-services.json`
6. Add the Google Services plugin to `native/androidApp/build.gradle.kts`:
```kotlin
plugins {
    // ... existing plugins
    id("com.google.gms.google-services")
}
```
7. Add to `native/build.gradle.kts`:
```kotlin
plugins {
    // ... existing plugins
    id("com.google.gms.google-services") version "4.4.2" apply false
}
```

### Troubleshooting Android

| Problem | Solution |
|---------|----------|
| "SDK location not found" | Set `ANDROID_HOME` env var, or set in Android Studio → Settings → SDK |
| "Failed to find target" | Install SDK 35 via SDK Manager |
| "Kakao SDK error" | Replace `{NATIVE_APP_KEY}` in AndroidManifest.xml with your Kakao key |
| Build OOM | Add to `gradle.properties`: `org.gradle.jvmargs=-Xmx4096m` |
| Emulator slow | Enable hardware acceleration: SDK Manager → SDK Tools → Intel HAXM |

---

## Part B: iOS App — Xcode

### Step 1: Generate the Shared Framework

The iOS app depends on the KMP shared module compiled as an iOS framework.

```bash
cd native/

# Generate Gradle wrapper if not already done
# (Android Studio should have done this in Part A)

# Build the shared framework for iOS Simulator (arm64 for Apple Silicon Mac)
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64

# The framework will be at:
# native/shared/build/bin/iosSimulatorArm64/debugFramework/shared.framework
```

### Step 2: Create the Xcode Project

1. Open **Xcode**
2. Click **"Create New Project"**
3. Select **iOS → App** → **Next**
4. Fill in:
   - **Product Name**: `iosApp`
   - **Team**: Your Apple Developer team (or "None" for simulator-only)
   - **Organization Identifier**: `com.imirae`
   - **Bundle Identifier**: `com.imirae.incheon` (auto-filled)
   - **Interface**: **SwiftUI**
   - **Language**: **Swift**
5. Save it inside `native/iosApp/` (replacing or alongside existing files)
6. Xcode creates the `.xcodeproj`

### Step 3: Add the Shared Framework

1. In Xcode, select the **iosApp** project in the navigator (blue icon)
2. Select the **iosApp** target → **General** tab
3. Scroll to **"Frameworks, Libraries, and Embedded Content"**
4. Click **"+"** → **"Add Other..."** → **"Add Files..."**
5. Navigate to:
   ```
   native/shared/build/bin/iosSimulatorArm64/debugFramework/shared.framework
   ```
6. Select it, set **Embed** to **"Do Not Embed"** (it's a static framework)

### Step 4: Configure Framework Search Paths

1. Select the **iosApp** target → **Build Settings** tab
2. Search for "Framework Search Paths"
3. Add:
   ```
   $(SRCROOT)/../shared/build/bin/iosSimulatorArm64/debugFramework
   ```
4. Search for "Other Linker Flags"
5. Add: `-lsqlite3` (if needed by Ktor)

### Step 5: Replace Generated Files with Our Code

The Xcode project generator created its own `ContentView.swift` and app entry point.
Replace them with our files:

1. In Xcode's file navigator, **delete** the auto-generated `ContentView.swift` and app file
2. Right-click the **iosApp** group → **"Add Files to iosApp..."**
3. Navigate to `native/iosApp/iosApp/` and add ALL folders:
   - `Views/` (all screen files)
   - `Components/` (reusable UI)
   - `Navigation/` (AppNavigation.swift)
   - `Helpers/` (KoinHelper.swift, AuthViewModelWrapper.swift)
   - `Theme/` (AppTheme.swift)
   - `Notification/` (APNsDelegate.swift)
   - `Resources/` (Localizable.strings)
   - `imirae_incheonApp.swift` (app entry point)
   - `Info.plist`
4. Make sure **"Copy items if needed"** is **unchecked** (files are already in place)
5. Make sure **"Create groups"** is selected

### Step 6: Set the Info.plist

1. Select the **iosApp** target → **General** tab
2. Under **Identity**: set Bundle Identifier to `com.imirae.incheon`
3. Select **Build Settings** tab → search "Info.plist"
4. Set **Info.plist File** to: `iosApp/Info.plist`

### Step 7: Run on Simulator

1. In the top toolbar, select a simulator: **iPhone 16** (or any)
2. Click the **▶ Run** button (or press `⌘R`)
3. First build takes 2-3 minutes
4. The app should launch on the simulator showing the login screen

### Step 8: Kakao SDK Setup (for OAuth)

> Kakao login won't work without this. You can skip for initial testing.

1. Go to https://developers.kakao.com/
2. Create an app → get the **Native App Key**
3. In Xcode, open `Info.plist` and replace the URL scheme placeholder with your key
4. Add KakaoSDK via Swift Package Manager:
   - File → Add Package Dependencies
   - URL: `https://github.com/nickcisco/kakao-ios-sdk`
   - Add `KakaoSDKUser` package

### Troubleshooting iOS

| Problem | Solution |
|---------|----------|
| "No such module 'shared'" | Rebuild the framework: `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` |
| "Framework not found" | Check Framework Search Paths in Build Settings |
| "Signing" errors | Set Team in Signing & Capabilities, or use simulator only |
| Build error in shared | Check Java 17 is installed and JAVA_HOME is set |
| "arm64 architecture" issues | Ensure you built for the right target (SimulatorArm64 for M1/M2 Mac) |

---

## Quick Reference

### Project Structure
```
native/
├── shared/          ← KMP shared code (Kotlin, compiles to JVM + iOS framework)
├── androidApp/      ← Android app (Jetpack Compose)
├── iosApp/          ← iOS app (SwiftUI)
├── build.gradle.kts ← Root build config
└── settings.gradle.kts
```

### Useful Gradle Commands
```bash
# Android
./gradlew :androidApp:assembleDebug          # Build debug APK
./gradlew :androidApp:installDebug           # Install on connected device/emulator
./gradlew :androidApp:assembleRelease        # Build release APK

# iOS Framework
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64    # Simulator (Apple Silicon)
./gradlew :shared:linkDebugFrameworkIosX64               # Simulator (Intel Mac)
./gradlew :shared:linkReleaseFrameworkIosArm64           # Device (release)

# Shared
./gradlew :shared:allTests                   # Run shared module tests
./gradlew clean                              # Clean all build artifacts
```

### Key Files to Customize
- `native/androidApp/google-services.json` — Firebase config (get from Firebase Console)
- `native/androidApp/src/main/AndroidManifest.xml` — Replace `{NATIVE_APP_KEY}` with Kakao key
- `native/iosApp/iosApp/Info.plist` — Add your Kakao URL scheme
- `native/shared/.../network/ApiClient.kt` — Backend API base URL

---

## Version Info
- **Kotlin**: 2.1.0
- **AGP**: 8.7.3
- **Compose BOM**: 2024.12.01
- **Ktor**: 3.0.3
- **Koin**: 4.0.1
- **Min Android SDK**: 26 (Android 8.0)
- **Target Android SDK**: 35
- **iOS Deployment Target**: 16.0
