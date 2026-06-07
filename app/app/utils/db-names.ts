import { getTauriVersion } from '@tauri-apps/api/app'

const isDev = import.meta.env.DEV

export const DB_NAMES = {
  user: isDev ? 'sqlite:user.dev.db' : 'sqlite:user.db',
  ygo: isDev ? 'sqlite:cards-ygo.dev.db' : 'sqlite:cards-ygo.db',
} as const
