# USS Guard ProGuard Rules

# Preserve JavaScript Interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep USS Guard package
-keep class co.za.unifiedsecuritysolutions.ussguard.** { *; }

# OneSignal SDK
-keep class com.onesignal.** { *; }
-dontwarn com.onesignal.**

# Firebase / Google Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# OkHttp (used by OneSignal)
-dontwarn okhttp3.**
-dontwarn okio.**