import { invoke } from '@tauri-apps/api/core'

// Android : redemande les marges système au plugin natif, au cas où son
// premier envoi (à l'affichage de la WebView) est arrivé avant la page.
export default defineNuxtPlugin(async () => {
  if (!isAndroid()) return
  try {
    const m = await invoke<{ top: number; bottom: number; left: number; right: number }>(
      'plugin:safe-area|insets'
    )
    const s = document.documentElement.style
    // 0 partout = le plugin n'a pas encore reçu les marges : on garde env()
    if (m.top || m.bottom || m.left || m.right) {
      s.setProperty('--safe-top', `${m.top}px`)
      s.setProperty('--safe-bottom', `${m.bottom}px`)
      s.setProperty('--safe-left', `${m.left}px`)
      s.setProperty('--safe-right', `${m.right}px`)
    }
  } catch {}
})
