import type { PublishedState, SyncTransport } from './index'
import type { Snapshot } from './snapshot'
import { GoogleError, googleFetch, type GoogleFetch } from './google'

// ============================================================
// TRANSPORT GOOGLE DRIVE — un seul fichier JSON dans le dossier caché de
// l'appli (appDataFolder, invisible dans Drive, n'utilise que le scope
// drive.appdata).
//
// Écriture conditionnelle (comme kechimochi) : l'API Drive v3 n'expose
// plus d'ETag, on lit donc l'ETag via l'API v2 et on écrit avec
// `If-Match` : Google répond 412 si un autre appareil a écrit entre-temps.
// Création : si deux appareils créent le fichier en même temps, le plus
// récent supprime le sien et refusionne avec l'autre.
// ============================================================

export const SYNC_FILE = 'card-manager-sync.json'
const API = 'https://www.googleapis.com'

interface DriveFile {
  id: string
  createdTime: string
}

export class DriveTransport implements SyncTransport {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetch: GoogleFetch = googleFetch
  ) {}

  private async call(method: string, url: string, headers: [string, string][] = [], body?: string) {
    const res = await this.fetch(
      method,
      url,
      [['Authorization', `Bearer ${await this.token()}`], ...headers],
      body
    )
    if (res.status === 401)
      throw new GoogleError('NOT_CONNECTED', 'Accès Google expiré : reconnecte-toi')
    return res
  }

  private ok(res: { status: number; body: string }, what: string) {
    if (res.status < 200 || res.status >= 300)
      throw new GoogleError('HTTP', `Drive : ${what} impossible (${res.status})`)
    return res
  }

  private async files(): Promise<DriveFile[]> {
    const q = encodeURIComponent(`name = '${SYNC_FILE}' and trashed = false`)
    const res = this.ok(
      await this.call(
        'GET',
        `${API}/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id,createdTime)`
      ),
      'lecture'
    )
    return (JSON.parse(res.body).files ?? []) as DriveFile[]
  }

  private async etag(id: string): Promise<string | null> {
    const res = await this.call('GET', `${API}/drive/v2/files/${id}?fields=etag`)
    if (res.status === 404) return null
    return JSON.parse(this.ok(res, 'lecture').body).etag as string
  }

  async pull(): Promise<PublishedState | null> {
    const [file] = await this.files()
    if (!file) return null
    // relu tant que l'ETag change pendant la lecture (écriture concurrente)
    for (let i = 0; i < 3; i++) {
      const before = await this.etag(file.id)
      if (!before) return null
      const content = this.ok(
        await this.call('GET', `${API}/drive/v3/files/${file.id}?alt=media`),
        'téléchargement'
      )
      const after = await this.etag(file.id)
      if (before === after) {
        return {
          snapshot: JSON.parse(content.body) as Snapshot,
          version: `${file.id}|${after}`,
        }
      }
    }
    throw new GoogleError('HTTP', 'Le fichier de synchro change sans arrêt : réessaie')
  }

  async push(snapshot: Snapshot, expectedVersion: string | null): Promise<boolean> {
    const body = JSON.stringify(snapshot)
    if (expectedVersion) {
      const sep = expectedVersion.indexOf('|')
      const id = expectedVersion.slice(0, sep)
      const etag = expectedVersion.slice(sep + 1)
      const res = await this.call(
        'PUT',
        `${API}/upload/drive/v2/files/${id}?uploadType=media`,
        [
          ['Content-Type', 'application/json'],
          ['If-Match', etag],
        ],
        body
      )
      if (res.status === 412 || res.status === 404) return false // un autre appareil a écrit
      this.ok(res, 'enregistrement')
      return true
    }

    // aucun fichier lu : on le crée, sauf si un autre appareil vient de le faire
    if ((await this.files()).length) return false
    const boundary = `cm${crypto.randomUUID().replace(/-/g, '')}`
    const metadata = JSON.stringify({
      name: SYNC_FILE,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    })
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`
    const created = JSON.parse(
      this.ok(
        await this.call(
          'POST',
          `${API}/upload/drive/v3/files?uploadType=multipart&fields=id`,
          [['Content-Type', `multipart/related; boundary=${boundary}`]],
          multipart
        ),
        'création'
      ).body
    ) as { id: string }
    const all = await this.files()
    if (all.length > 1 && all[0]!.id !== created.id) {
      // créé en même temps qu'un autre appareil : le plus ancien gagne
      await this.call('DELETE', `${API}/drive/v3/files/${created.id}`)
      return false
    }
    return true
  }
}
