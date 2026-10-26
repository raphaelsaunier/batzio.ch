package ch.batzio.app.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** What the app remembers between launches (the token is encrypted with the Android Keystore). */
@Serializable
data class Preferences(
    val serverUrl: String,
    val tenant: String? = null,
    val user: UserInfo? = null,
    val companies: List<Company> = emptyList(),
    /** null follows the device language. */
    val locale: String? = null,
    /** "simple" (plain words) or "accountant" (classic terms, every module). */
    val mode: String = "simple",
    /** "system", "light" or "dark". */
    val appearance: String = "system",
)

class SessionStore(context: Context, private val defaultServer: String) {
    private val prefs = context.getSharedPreferences("batzio", Context.MODE_PRIVATE)

    fun load(): Preferences = prefs.getString("prefs", null)?.let { runCatching { BzJson.decodeFromString<Preferences>(it) }.getOrNull() }
        ?: Preferences(serverUrl = defaultServer.ifEmpty { "https://" })

    fun save(p: Preferences) = prefs.edit().putString("prefs", BzJson.encodeToString(Preferences.serializer(), p)).apply()

    /** Unlocks the on-device account. It only guards data that is already in the app's private storage, so it is kept as is. */
    var devicePassword: String?
        get() = prefs.getString("device-password", null)
        set(value) {
            if (value == null) prefs.edit().remove("device-password").apply() else prefs.edit().putString("device-password", value).apply()
        }

    var token: String?
        get() = prefs.getString("token", null)?.let { runCatching { decrypt(it) }.getOrNull() }
        set(value) {
            if (value == null) prefs.edit().remove("token").apply() else prefs.edit().putString("token", encrypt(value)).apply()
        }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = cipher.iv + cipher.doFinal(text.toByteArray())
        return Base64.encodeToString(data, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val data = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, 12)) }
        return String(cipher.doFinal(data, 12, data.size - 12))
    }

    private companion object {
        const val ALIAS = "batzio-session"
    }
}
