# USS Guard — Android APK Build Guide

A full native Android WebView app wrapping the USS Guard web platform.

## What it does

- Loads `https://guard-track-pro-26cedab8.base44.app` in a **native Android WebView** (not TWA, not Custom Tab, not browser redirect)
- **Full-screen immersive** — no address bar, no navigation bar, no status bar
- **JavaScript** + **DOM storage** + **hardware acceleration** enabled
- **Camera access** — for QR scanning, photo capture, video calls
- **Microphone/audio** — for voice calls and PTT radio
- **File upload** — `<input type="file">` works natively via `onShowFileChooser`
- **POST_NOTIFICATIONS** — requested on first launch (Android 13+)
- **Global incoming-call handler** — call listener runs at the app root, active on
  every page after login. Survives navigation across Dashboard, Contacts, Reports,
  Shifts, Sites, etc. Only cleaned up on logout.
- **Push notification fallback** — when the app is minimized/backgrounded, OneSignal
  push notifications are delivered via the service worker. Tapping the notification
  brings the app to the foreground and triggers the incoming-call modal.
- **Back button** navigates WebView history
- App name: **USS Guard**
- Package ID: `co.za.unifiedsecuritysolutions.ussguard`

---

## Prerequisites

1. **Android Studio** (Hedgehog 2023.1.1+) — https://developer.android.com/studio
2. **Java JDK 11+** (bundled with Android Studio)

---

## Build steps

### 1. Open the project

1. Copy this entire `android/` folder to your computer.
2. Android Studio → **Open** → select the `android/` folder.
3. Wait for Gradle sync (downloads dependencies on first run).

### 2. Add the app icon

The project references `@mipmap/ic_launcher` and `mipmap/ic_launcher_round`:

1. Right-click `app/src/main/res/` → **New** → **Image Asset**
2. **Icon Type:** Launcher Icons
3. **Name:** `ic_launcher`
4. Upload your USS Guard logo
5. **Finish** — generates all densities automatically

### 3. Build a signed APK with your JKS keystore

1. **Build** → **Generate Signed Bundle / APK** → **APK**
2. Click **Choose existing** and select your `.jks` keystore file
3. Enter your keystore password, alias, and key password
4. Select **release** build type
5. Click **Create**

Output: `app/build/outputs/apk/release/app-release.apk`

---

## Signing configuration (optional — in build.gradle)

To auto-sign debug & release builds with your keystore, add to `android/app/build.gradle`:

```groovy
android {
    // ... existing config ...

    signingConfigs {
        release {
            storeFile file("path/to/your-keystore.jks")
            storePassword "your-keystore-password"
            keyAlias "your-key-alias"
            keyPassword "your-key-password"
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

---

## Permissions

Requested at first launch:

| Permission | Purpose |
|---|---|
| `CAMERA` | QR scanning, photo capture, video calls |
| `RECORD_AUDIO` | Voice calls, PTT radio |
| `ACCESS_FINE_LOCATION` | GPS tracking, geofencing |
| `ACCESS_COARSE_LOCATION` | Approximate location |
| `POST_NOTIFICATIONS` | Push notifications (Android 13+) |
| `VIBRATE` | Notification vibration patterns |
| `WAKE_LOCK` | Keep app alive in background |

---

## Configuration

To change the app URL, edit `MainActivity.java`:

```java
private static final String APP_URL = "https://guard-track-pro-26cedab8.base44.app";
```

## Notes

- The WebView handles `getUserMedia()` natively via `WebChromeClient.onPermissionRequest()`
- File uploads (`<input type="file">`) work via `onShowFileChooser` with multi-file support
- Push notifications are delivered through OneSignal's web SDK running inside the WebView
- WebView state is saved/restored on rotation and app restart
- External links (non-base44.app) open in the system browser