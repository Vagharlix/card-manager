import { invoke } from '@tauri-apps/api/core'
import { useDatabase } from '~/composables/useDatabase'

// ============================================================
// COMPTE GOOGLE pour la synchro Drive.
//  - PC : flux « application installée » : le navigateur s'ouvre sur la
//    page de Google, qui renvoie vers http://127.0.0.1:<port> (écouté par
//    la commande Rust oauth_loopback_*), avec PKCE. Le jeton de
//    renouvellement est gardé dans sync_state (base locale).
//  - Android : connexion native (plugin google-auth, Play Services) ; un
//    jeton d'accès est redemandé sans écran quand il le faut.
// Seul accès demandé : le dossier caché de l'appli (drive.appdata) +
// l'adresse e-mail (affichée dans les réglages).
// Les requêtes passent par la commande Rust google_request (pas de CORS).
// ============================================================

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
]

export interface GoogleResponse {
  status: number
  body: string
}

export type GoogleFetch = (
  method: string,
  url: string,
  headers?: [string, string][],
  body?: string
) => Promise<GoogleResponse>

export const googleFetch: GoogleFetch = (method, url, headers = [], body) =>
  invoke<GoogleResponse>('google_request', { method, url, headers, body: body ?? null })

export class GoogleError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'CANCELLED' | 'HTTP',
    message: string
  ) {
    super(message)
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined
const android = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

/** La synchro est-elle possible dans ce build (identifiants Google fournis à la compilation) ? */
export function googleAvailable(): boolean {
  return android() || !!CLIENT_ID
}

interface StoredAccount {
  email: string | null
  refreshToken?: string // PC seulement
  accessToken?: string
  expiresAt?: number // ms
}

const STATE_KEY = 'google_account'

async function loadAccount(): Promise<StoredAccount | null> {
  const { user } = await useDatabase()
  const rows = await user.select<{ value: string }[]>(
    `SELECT value FROM sync_state WHERE key = ?`,
    [STATE_KEY]
  )
  return rows[0] ? (JSON.parse(rows[0].value) as StoredAccount) : null
}

async function saveAccount(a: StoredAccount | null): Promise<void> {
  const { user } = await useDatabase()
  if (!a) {
    await user.execute(`DELETE FROM sync_state WHERE key = ?`, [STATE_KEY])
    return
  }
  await user.execute(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [STATE_KEY, JSON.stringify(a), new Date().toISOString()]
  )
}

// ── PKCE ──
function randomUrlSafe(bytes = 48): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return base64Url(b)
}

function base64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

async function tokenRequest(fetch: GoogleFetch, fields: Record<string, string>) {
  const res = await fetch(
    'POST',
    'https://oauth2.googleapis.com/token',
    [['Content-Type', 'application/x-www-form-urlencoded']],
    form(fields)
  )
  const json = JSON.parse(res.body || '{}')
  if (res.status !== 200) {
    if (json.error === 'invalid_grant')
      throw new GoogleError('NOT_CONNECTED', 'Google access was removed: sign in again')
    throw new GoogleError('HTTP', `Google refused (${res.status} ${json.error ?? ''})`)
  }
  return json as { access_token: string; expires_in: number; refresh_token?: string }
}

async function fetchEmail(fetch: GoogleFetch, accessToken: string): Promise<string | null> {
  const res = await fetch('GET', 'https://www.googleapis.com/oauth2/v3/userinfo', [
    ['Authorization', `Bearer ${accessToken}`],
  ])
  return res.status === 200 ? ((JSON.parse(res.body).email as string) ?? null) : null
}

// ── connexion ──
export async function connectGoogle(fetch: GoogleFetch = googleFetch): Promise<string | null> {
  if (android()) {
    const r = await invoke<{ accessToken: string }>('plugin:google-auth|authorize', {
      allowInteraction: true,
    }).catch((e) => {
      throw String(e).includes('cancelled') ? new GoogleError('CANCELLED', 'Sign-in cancelled') : e
    })
    const email = await fetchEmail(fetch, r.accessToken)
    await saveAccount({ email, accessToken: r.accessToken, expiresAt: Date.now() + 50 * 60_000 })
    return email
  }

  if (!CLIENT_ID) throw new GoogleError('NOT_CONFIGURED', 'Sync is not available in this build')
  const verifier = randomUrlSafe()
  const state = randomUrlSafe(16)
  const port = await invoke<number>('oauth_loopback_start')
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    form({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      access_type: 'offline', // jeton de renouvellement
      prompt: 'consent',
    })
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
  const cb = await invoke<{ code: string | null; state: string | null; error: string | null }>(
    'oauth_loopback_wait',
    { port, timeoutSecs: 300 }
  )
  if (cb.error) throw new GoogleError('CANCELLED', 'Sign-in refused or cancelled')
  if (!cb.code || cb.state !== state) throw new GoogleError('HTTP', 'Invalid response from Google')

  const t = await tokenRequest(fetch, {
    code: cb.code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET ?? '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  })
  const email = await fetchEmail(fetch, t.access_token)
  await saveAccount({
    email,
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  })
  return email
}

/** Compte connecté (sans réseau). */
export async function googleAccount(): Promise<{ email: string | null } | null> {
  const a = await loadAccount()
  return a ? { email: a.email } : null
}

/**
 * Jeton d'accès valide. Jamais d'écran : si l'accès a été retiré,
 * NOT_CONNECTED (l'utilisateur se reconnecte depuis les réglages).
 */
export async function accessToken(fetch: GoogleFetch = googleFetch): Promise<string> {
  const a = await loadAccount()
  if (!a) throw new GoogleError('NOT_CONNECTED', 'No Google account connected')
  if (a.accessToken && a.expiresAt && a.expiresAt - 60_000 > Date.now()) return a.accessToken

  if (android()) {
    const r = await invoke<{ accessToken?: string; requiresInteraction?: boolean }>(
      'plugin:google-auth|authorize',
      { allowInteraction: false }
    )
    if (!r.accessToken) throw new GoogleError('NOT_CONNECTED', 'Sign in to Google again')
    await saveAccount({ ...a, accessToken: r.accessToken, expiresAt: Date.now() + 50 * 60_000 })
    return r.accessToken
  }

  if (!a.refreshToken || !CLIENT_ID)
    throw new GoogleError('NOT_CONNECTED', 'Sign in to Google again')
  try {
    const t = await tokenRequest(fetch, {
      refresh_token: a.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    })
    await saveAccount({
      ...a,
      accessToken: t.access_token,
      expiresAt: Date.now() + t.expires_in * 1000,
    })
    return t.access_token
  } catch (e) {
    if (e instanceof GoogleError && e.code === 'NOT_CONNECTED') await saveAccount(null)
    throw e
  }
}

export async function disconnectGoogle(fetch: GoogleFetch = googleFetch): Promise<void> {
  const a = await loadAccount()
  if (a?.accessToken) {
    try {
      if (android()) await invoke('plugin:google-auth|clear_token', { accessToken: a.accessToken })
      else
        await fetch(
          'POST',
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refreshToken ?? a.accessToken)}`
        )
    } catch {
      // déconnexion locale quoi qu'il arrive
    }
  }
  await saveAccount(null)
}
