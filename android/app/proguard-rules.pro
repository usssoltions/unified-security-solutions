# Keep WebView and JavaScript interface classes
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.ussguard.app.** { *; }