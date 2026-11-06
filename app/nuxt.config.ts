// https://nuxt.com/docs/api/configuration/nuxt-config
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
})
