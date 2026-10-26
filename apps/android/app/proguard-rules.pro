# kotlinx.serialization keeps generated serializers via its own rules.
-keepattributes *Annotation*, InnerClasses

# The on-device engine calls these from JavaScript by name.
-keepclassmembers class ch.batzio.app.core.LocalEngine$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
