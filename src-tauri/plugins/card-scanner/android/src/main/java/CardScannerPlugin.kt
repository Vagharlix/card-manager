package app.cardmanager.cardscanner

import android.app.Activity
import android.graphics.BitmapFactory
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

@InvokeArg
class RecognizeArgs {
    // image JPEG/PNG encodée en base64 (sans préfixe data:)
    var image: String = ""
}

// Reconnaissance de texte sur une image capturée par le front (caméra de la
// WebView). Renvoie les lignes lues avec leur position, pour que le front
// identifie la carte (code d'impression, nom).
@TauriPlugin
class CardScannerPlugin(private val activity: Activity) : Plugin(activity) {
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    @Command
    fun recognize(invoke: Invoke) {
        val args = invoke.parseArgs(RecognizeArgs::class.java)
        val bytes = try {
            Base64.decode(args.image, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            invoke.reject("invalid image")
            return
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
            invoke.reject("invalid image")
            return
        }

        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { text ->
                val lines = JSArray()
                for (block in text.textBlocks) {
                    for (line in block.lines) {
                        val o = JSObject()
                        o.put("text", line.text)
                        line.boundingBox?.let {
                            o.put("x", it.left)
                            o.put("y", it.top)
                            o.put("w", it.width())
                            o.put("h", it.height())
                        }
                        lines.put(o)
                    }
                }
                val res = JSObject()
                res.put("lines", lines)
                res.put("width", bitmap.width)
                res.put("height", bitmap.height)
                invoke.resolve(res)
            }
            .addOnFailureListener { e ->
                invoke.reject(e.message ?: "recognition failed")
            }
    }
}
