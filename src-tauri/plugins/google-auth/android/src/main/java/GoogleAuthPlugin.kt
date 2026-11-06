package app.cardmanager.googleauth

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope

// Connexion Google native (Google Play Services) pour la synchro Drive.
// L'appli est reconnue par son nom de paquet + l'empreinte SHA-1 de sa clé
// de signature (client OAuth « Android » du projet Google Cloud) : pas de
// secret dans l'APK. Le jeton d'accès (1 h) est redemandé sans interface
// tant que l'utilisateur n'a pas retiré son accord.

private const val SCOPE_DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"
private const val SCOPE_EMAIL = "https://www.googleapis.com/auth/userinfo.email"

@InvokeArg
class AuthorizeArgs {
  // false : vérification silencieuse au démarrage, jamais d'écran
  var allowInteraction: Boolean = false
}

@InvokeArg
class ClearTokenArgs {
  lateinit var accessToken: String
}

@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun authorize(invoke: Invoke) {
    val args = invoke.parseArgs(AuthorizeArgs::class.java)
    val request = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(SCOPE_DRIVE_APPDATA), Scope(SCOPE_EMAIL)))
      .build()

    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result ->
        val pendingIntent = result.pendingIntent
        if (pendingIntent == null) {
          resolve(invoke, result)
          return@addOnSuccessListener
        }
        if (!args.allowInteraction) {
          invoke.resolve(JSObject().apply { put("requiresInteraction", true) })
          return@addOnSuccessListener
        }
        startIntentSenderForResult(
          invoke,
          IntentSenderRequest.Builder(pendingIntent.intentSender).build(),
          "onAuthorizationResult"
        )
      }
      .addOnFailureListener { error ->
        invoke.reject(error.localizedMessage ?: "Connexion Google impossible")
      }
  }

  @Command
  fun clearToken(invoke: Invoke) {
    val args = invoke.parseArgs(ClearTokenArgs::class.java)
    Identity.getAuthorizationClient(activity)
      .clearToken(ClearTokenRequest.builder().setToken(args.accessToken).build())
      .addOnSuccessListener { invoke.resolve() }
      .addOnFailureListener { error ->
        invoke.reject(error.localizedMessage ?: "Impossible d'oublier le jeton Google")
      }
  }

  @ActivityCallback
  fun onAuthorizationResult(invoke: Invoke, result: ActivityResult) {
    try {
      val data = result.data
      if (data == null) {
        invoke.reject(
          if (result.resultCode == Activity.RESULT_CANCELED) "cancelled"
          else "Connexion Google sans réponse"
        )
        return
      }
      resolve(invoke, Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data))
    } catch (error: ApiException) {
      invoke.reject(
        if (error.statusCode == CommonStatusCodes.CANCELED) "cancelled"
        else error.localizedMessage ?: "Connexion Google impossible"
      )
    }
  }

  private fun resolve(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrBlank()) {
      invoke.reject("Google n'a pas renvoyé de jeton d'accès")
      return
    }
    invoke.resolve(JSObject().apply { put("accessToken", token) })
  }
}
