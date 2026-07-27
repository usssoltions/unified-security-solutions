# USS Guard — Android APK Build Guide

A full native Android WebView app wrapping the USS Guard web platform.

## ⚠️ Prerequisites: Firebase + OneSignal Setup

The app uses the **OneSignal Android SDK** for native push notifications (calls,
alerts) when the app is minimized or closed. This requires Firebase Cloud
Messaging (FCM) credentials.

### One-Time Setup

1. **Create a Firebase project**: https://console.firebase.google.com/
2. **Add an Android app** in Firebase Console with package name:
   `co.za.unifiedsecuritysolutions.ussguard`
3. **Download `google-services.json`** and place it in:
   `android/app/google-services.json`
4. **Link Firebase to OneSignal**: In your OneSignal dashboard →
   Settings → Platforms → Google Android → enter your Firebase
   Server Key and Sender ID.
5. The OneSignal App ID (`efd5b25f-e103-4aca-bc00-2b010194fdb9`) is
   already hardcoded in `USSGuardApplication.java`.

> Without `google-services.json`, the Gradle build will fail with a
> clear error from the `google-services` plugin.

## What it does

- Loads `https://guard-track-pro-26cedab8.base44.app` in a **native Android WebView** (not TWA, not Custom Tab, not browser redirect)
- **Full-screen immersive** — no address bar, no navigation bar, no status bar
- **JavaScript** + **DOM storage** + **hardware acceleration** enabled
- **Camera access** — for QR scanning, photo capture, video calls
- **Microphone/audio** — for voice calls and PTT radio
- **File upload** — `<input type="file">` works natively via `onShowFileChooser`
- **POST_NOTIFICATIONS** — requested on first launch (Android 13+)
- **Native OneSignal SDK** — push notifications delivered via FCM, not the
  WebView service worker. Works when app is minimized or fully closed.
- **High-priority call notification channel** — sound + vibration + public
  visibility on lock screen
- **Full-screen incoming call UI** — native `IncomingCallActivity` with caller
  name, initials avatar, Accept (green) and Decline (red) buttons
- **Continuous ringtone** — device ringtone loops until answered, declined, or
  auto-dismissed after 45 seconds
- **Screen wake on lock screen** — activity uses `showWhenLocked` +
  `turnScreenOn` + `SCREEN_BRIGHT_WAKE_LOCK` to wake the device and display
  the call UI over the lock screen
- **Android CallStyle** — uses `Notification.CallStyle` on Android 12+ for the
  native call notification look
- **Full-screen intent** — uses `setFullScreenIntent()` so the call screen
  appears immediately when the device is locked or the app is in background
- **Global incoming-call handler** — mounted at the app root (outside Routes),
  active on EVERY page after login. Survives navigation. Only cleaned up on logout.
- **Notification click → incoming call screen** — tapping a call notification
  opens USS Guard and passes `call_id` + `caller_name` to the WebView, triggering
  the incoming call modal.
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