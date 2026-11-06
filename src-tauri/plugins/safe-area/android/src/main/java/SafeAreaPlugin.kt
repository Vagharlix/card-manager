package app.cardmanager.safearea

import android.app.Activity
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// L'app est affichée bord à bord (Android 15+, SDK cible >= 35) : la WebView
// passe sous la barre d'état et la barre de gestes. On lit ces marges (en px
// CSS) et on les pousse dans la page en variables CSS --safe-*. La page les
// redemande aussi au démarrage (commande `insets`), au cas où le premier
// envoi arrive avant son chargement.
@TauriPlugin
class SafeAreaPlugin(private val activity: Activity) : Plugin(activity) {
    private var top = 0f
    private var bottom = 0f
    private var left = 0f
    private var right = 0f

    override fun load(webView: WebView) {
        super.load(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val d = v.resources.displayMetrics.density
            top = bars.top / d
            bottom = bars.bottom / d
            left = bars.left / d
            right = bars.right / d
            val js = "(function(s){s.setProperty('--safe-top','${top}px');" +
                "s.setProperty('--safe-bottom','${bottom}px');" +
                "s.setProperty('--safe-left','${left}px');" +
                "s.setProperty('--safe-right','${right}px');})" +
                "(document.documentElement.style)"
            webView.post { webView.evaluateJavascript(js, null) }
            insets
        }
        ViewCompat.requestApplyInsets(webView)
    }

    @Command
    fun insets(invoke: Invoke) {
        val res = JSObject()
        res.put("top", top.toDouble())
        res.put("bottom", bottom.toDouble())
        res.put("left", left.toDouble())
        res.put("right", right.toDouble())
        invoke.resolve(res)
    }
}
