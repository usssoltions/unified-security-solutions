# Keep WebView and JavaScript interface classes
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class co.za.unifiedsecuritysolutions.ussguard.** { *; }