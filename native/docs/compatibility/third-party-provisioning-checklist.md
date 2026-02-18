# P0.4 — Third-Party Services Provisioning Checklist

> ⚠️ **HUMAN ACTION REQUIRED**: This checklist requires manual registration on external service consoles. It cannot be automated.

## Package & Bundle Identifiers

| Platform | Identifier | Status |
|----------|-----------|--------|
| Android | `com.imirae.incheon` | ☐ Register in Play Console |
| iOS | `com.imirae.incheon` | ☐ Register in Apple Developer Portal |

## 1. Kakao Developer Console

### Android App Registration
- [ ] Log in to [Kakao Developers](https://developers.kakao.com/)
- [ ] Navigate to app settings → Platforms → Android
- [ ] Add package name: `com.imirae.incheon`
- [ ] Add key hash (debug): Run `keytool -exportcert -alias androiddebugkey -keystore ~/.android/debug.keystore | openssl sha1 -binary | openssl base64`
- [ ] Add key hash (release): Generate from release keystore
- [ ] Enable Kakao Login in app settings
- [ ] Note Kakao App Key (Native App Key)

### iOS App Registration
- [ ] Navigate to app settings → Platforms → iOS
- [ ] Add bundle ID: `com.imirae.incheon`
- [ ] Enable Kakao Login in app settings
- [ ] Note Kakao App Key (Native App Key)

### Secrets to Store
- `KAKAO_NATIVE_APP_KEY` — Used in both Android and iOS apps

## 2. Firebase Project

### Project Setup
- [ ] Go to [Firebase Console](https://console.firebase.google.com/)
- [ ] Create project or use existing project for imirae-incheon
- [ ] Enable Cloud Messaging (FCM)

### Android App
- [ ] Add Android app with package name `com.imirae.incheon`
- [ ] Add SHA-1 fingerprint (debug): `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey`
- [ ] Add SHA-1 fingerprint (release): From release keystore
- [ ] Download `google-services.json`
- [ ] Store in secrets manager (NOT in git repo)

### iOS App
- [ ] Add iOS app with bundle ID `com.imirae.incheon`
- [ ] Download `GoogleService-Info.plist`
- [ ] Store in secrets manager (NOT in git repo)

### Backend Service Account
- [ ] Generate Firebase Admin SDK service account key
- [ ] Store in backend secrets manager for push notification sending
- [ ] Verify `firebase-admin` is installed in NestJS backend (or file CR-PUSH-02)

### Secrets to Store
- `google-services.json` — Android Firebase config
- `GoogleService-Info.plist` — iOS Firebase config
- Firebase Admin SDK service account JSON — Backend push sending

## 3. Apple Developer Account

### App ID
- [ ] Log in to [Apple Developer Portal](https://developer.apple.com/)
- [ ] Register App ID: `com.imirae.incheon`
- [ ] Enable capabilities:
  - [x] Push Notifications
  - [x] Associated Domains (for universal links)
  - [x] Sign in with Apple (if needed later)

### Push Notification Configuration
- [ ] Create APNs Key (recommended over certificates)
- [ ] Download `.p8` key file
- [ ] Note Key ID and Team ID
- [ ] Upload APNs key to Firebase project (for FCM → APNs relay)

### Provisioning Profiles
- [ ] Create Development provisioning profile
- [ ] Create Distribution provisioning profile (for TestFlight/App Store)

### Secrets to Store
- APNs `.p8` key file
- Key ID
- Team ID
- Provisioning profiles

## 4. Android Signing

### Debug Keystore
- [ ] Use default debug keystore at `~/.android/debug.keystore`
- [ ] Extract SHA-1 and SHA-256 fingerprints

### Release Keystore
- [ ] Generate release keystore: `keytool -genkey -v -keystore release.keystore -alias imirae -keyalg RSA -keysize 2048 -validity 10000`
- [ ] Store keystore file in secrets manager
- [ ] Configure Play App Signing (upload key + app signing key)

### Secrets to Store
- Release keystore file (`.jks`)
- Keystore password
- Key alias and password

## 5. Git Configuration

### .gitignore Rules (add to native/.gitignore)
```
# Firebase config files (contain API keys)
google-services.json
GoogleService-Info.plist

# Signing keys
*.keystore
*.jks
*.p8
*.p12
*.mobileprovision

# Local properties with secrets
local.properties
```

## 6. CI/CD Secret Configuration

### GitHub Actions Secrets
| Secret Name | Description | Used By |
|------------|-------------|---------|
| `GOOGLE_SERVICES_JSON` | Base64-encoded google-services.json | Android CI |
| `GOOGLE_SERVICE_INFO_PLIST` | Base64-encoded GoogleService-Info.plist | iOS CI |
| `KAKAO_NATIVE_APP_KEY` | Kakao SDK app key | Both platforms |
| `ANDROID_KEYSTORE` | Base64-encoded release keystore | Android release |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | Android release |
| `ANDROID_KEY_ALIAS` | Key alias | Android release |
| `ANDROID_KEY_PASSWORD` | Key password | Android release |
| `APPLE_TEAM_ID` | Apple Developer Team ID | iOS CI |
| `APPLE_CERTIFICATE` | Distribution certificate | iOS release |
| `APPLE_PROVISIONING_PROFILE` | Distribution profile | iOS release |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK key | Backend push |

## Completion Criteria

- [ ] All services registered with correct identifiers
- [ ] All config files downloaded and stored in secrets manager
- [ ] `.gitignore` updated to exclude credential files
- [ ] `git status` shows no credential files tracked
- [ ] CI secrets configured in GitHub repository settings
- [ ] Team members with access documented

## Access Owners

| Service | Owner | Backup |
|---------|-------|--------|
| Kakao Developer Console | TODO | TODO |
| Firebase Console | TODO | TODO |
| Apple Developer Portal | TODO | TODO |
| Play Console | TODO | TODO |
| GitHub Secrets | TODO | TODO |
