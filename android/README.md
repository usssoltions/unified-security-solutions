# USS Guard — Android APK Build Guide

This folder contains a complete Android Studio project that wraps your SecureGuard web app in a **full-screen WebView** (not a browser tab).

## What it does

- Loads `https://guard-track-pro-26cedab8.base44.app` in a native Android WebView
- **Full-screen immersive mode** — no address bar, no navigation bar, no status bar
- **JavaScript enabled** with DOM storage, geolocation, and hardware acceleration
- **Camera & microphone permissions** granted to the WebView for QR scanning, photo capture, and voice calls
- **Back button** navigates WebView history (like a native app)
- USS Guard app icon and launcher name

---

## Prerequisites

1. **Android Studio** (Hedgehog 2023.1.1 or newer) — download from https://developer.android.com/studio
2. **Java JDK 11+** (bundled with Android Studio)

---

## Steps to build the APK

### 1. Open the project

1. Copy this entire `android/` folder to your computer.
2. Open Android Studio → **Open** → select the `android/` folder.
3. Wait for Gradle sync to complete (first time downloads dependencies — may take a few minutes).

### 2. Add the app icon

The project references `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`. You need to add icon images:

1. Right-click `app/src/main/res/` → **New** → **Image Asset**
2. **Icon Type:** Launcher Icons
3. **Name:** `ic_launcher`
4. Upload your USS Guard logo image (use the icon from your web app)
5. Click **Next** → **Finish**

This generates all required sizes (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi) automatically.

### 3. Build the APK

#### Debug APK (for testing):
- Menu: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
- The APK appears at: `app/build/outputs/apk/debug/app-debug.apk`

#### Release APK (for distribution):
1. Generate a signing key:
   ```
   keytool -genkey -v -keystore uss-guard.keystore -alias uss-guard -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In Android Studio: **Build** → **Generate Signed Bundle / APK** → **APK**
3. Choose your keystore, enter passwords
4. Select **release** build type
5. Click **Create**

The signed APK appears at: `app/build/outputs/apk/release/app-release.apk`

### 4. Install on Android

1. Transfer the `.apk` file to your Android phone
2. Open the file (may need to enable "Install from unknown sources" in Settings)
3. Install and launch — **USS Guard** appears as a native app

---

## Configuration

To change the app URL, edit `MainActivity.java`:

```java
private static final String APP_URL = "https://guard-track-pro-26cedab8.base44.app";
```

## Permissions

The app requests these permissions at launch:
- **Camera** — for QR code scanning and photo capture
- **Microphone** — for voice calls and PTT radio
- **Location** — for GPS tracking and geofencing
- **Vibration** — for push notification alerts
- **Wake Lock** — to keep the app running in background

---

## Notes

- The WebView handles `getUserMedia()` (camera/mic) requests natively via `WebChromeClient.onPermissionRequest()`
- Push notifications are delivered through OneSignal's web SDK running inside the WebView — no native FCM integration needed
- The app saves WebView state on rotation and restores it on restart
- External links (non-base44.app) open in the system browser