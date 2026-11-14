package app.flintnotes.googleauth

import android.app.Activity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google sign-in for Drive on Android (MOB-13, D-165, docs/05 §8): Google's authorization API asks
 * for the drive.file scope with Flint's Android OAuth client (the app's package and signing
 * certificate, registered in the Flint Cloud project). After the first consent, access tokens come
 * from Google Play services without asking again. Nothing here stores a token.
 */
class FlintGoogleAuthModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("FlintGoogleAuth")

    /**
     * An access token for `scopes`. `interactive`: Google's consent screen may show (Connect);
     * otherwise a token is only returned when consent was given before (background syncs).
     */
    AsyncFunction("authorize") { scopes: List<String>, interactive: Boolean, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "Flint isn't in the foreground", null)
        return@AsyncFunction
      }
      val request = AuthorizationRequest.builder()
        .setRequestedScopes(scopes.map { Scope(it) })
        .build()
      Identity.getAuthorizationClient(activity)
        .authorize(request)
        .addOnSuccessListener { result ->
          if (!result.hasResolution()) {
            promise.resolve(tokenOf(result))
            return@addOnSuccessListener
          }
          val intent = result.pendingIntent
          if (!interactive || intent == null) {
            promise.reject("NEEDS_CONSENT", "Google needs you to allow access again", null)
            return@addOnSuccessListener
          }
          if (pending != null) {
            promise.reject("BUSY", "A sign-in is already open", null)
            return@addOnSuccessListener
          }
          pending = promise
          try {
            activity.startIntentSenderForResult(intent.intentSender, REQUEST_CODE, null, 0, 0, 0, null)
          } catch (error: Exception) {
            pending = null
            promise.reject("CONSENT_FAILED", error.message, error)
          }
        }
        .addOnFailureListener { error -> promise.reject(codeOf(error), error.message, error) }
    }

    /** Forgets a token Google Play services cached (Drive said 401): the next authorize gets a new one. */
    AsyncFunction("clearToken") { token: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      Identity.getAuthorizationClient(context)
        .clearToken(ClearTokenRequest.builder().setToken(token).build())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { error -> promise.reject(codeOf(error), error.message, error) }
    }

    OnActivityResult { activity: Activity, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.reject("CANCELLED", "Sign-in cancelled", null)
        return@OnActivityResult
      }
      try {
        val result = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(payload.data)
        promise.resolve(tokenOf(result))
      } catch (error: ApiException) {
        promise.reject(codeOf(error), error.message, error)
      }
    }
  }

  private fun tokenOf(result: AuthorizationResult): Map<String, Any?> =
    mapOf(
      "accessToken" to result.accessToken,
      "scopes" to result.grantedScopes.toList(),
    )

  private fun codeOf(error: Exception): String =
    if (error is ApiException) "GOOGLE_${error.statusCode}" else "AUTH_FAILED"

  companion object {
    private const val REQUEST_CODE = 0x464c // "FL"
  }
}
