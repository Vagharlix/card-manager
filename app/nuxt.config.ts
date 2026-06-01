// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    server: {
      strictPort: true,
    },
    optimizeDeps: {
      include: ['@tauri-apps/plugin-sql', '@tauri-apps/api/app']
    }
  },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
})