// https://nuxt.com/docs/api/configuration/nuxt-config

// icônes que les composants Nuxt UI affichent d'eux-mêmes (app.config de
// Nuxt UI : flèches, coches, fermeture, chargement…)
const NUXT_UI_ICONS = [
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'arrow-up-right',
  'check',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'chevrons-left',
  'chevrons-right',
  'circle-alert',
  'circle-check',
  'circle-x',
  'copy',
  'copy-check',
  'ellipsis',
  'eye',
  'eye-off',
  'file',
  'folder',
  'folder-open',
  'grip-vertical',
  'hash',
  'info',
  'lightbulb',
  'loader-circle',
  'menu',
  'minus',
  'monitor',
  'moon',
  'panel-left-close',
  'panel-left-open',
  'plus',
  'rotate-ccw',
  'search',
  'square',
  'sun',
  'terminal',
  'triangle-alert',
  'upload',
  'x',
]

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      // viewport-fit=cover : la page s'étend sous les barres système, les
      // marges --safe-* (main.css) gardent le contenu lisible
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
      ],
    },
  },
  // Tauri mobile : l'appareil doit joindre le serveur de dev via TAURI_DEV_HOST
  devServer: {
    host: process.env.TAURI_DEV_HOST || 'localhost',
  },
  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    server: {
      strictPort: true,
    },
    optimizeDeps: {
      include: ['@tauri-apps/plugin-sql', '@tauri-apps/api/app'],
    },
  },
  modules: ['@nuxt/ui', '@vueuse/nuxt'],
  css: ['~/assets/css/main.css'],
  // icônes embarquées dans l'appli (@iconify-json/lucide) : sans cela, chaque
  // icône était téléchargée depuis api.iconify.design à sa 1re apparition
  // (icônes en retard, absentes hors ligne). On embarque celles du code
  // (.vue et .ts : certaines sont choisies dans des fonctions) et celles que
  // Nuxt UI affiche lui-même ; une icône oubliée passerait encore par le réseau.
  icon: {
    clientBundle: {
      scan: { globInclude: ['app/**/*.{vue,ts}'] },
      icons: NUXT_UI_ICONS.map((name) => `lucide:${name}`),
    },
  },
})
