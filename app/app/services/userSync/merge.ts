import {
  SYNC_TABLES,
  indexRows,
  keyOf,
  sameRow,
  sameValue,
  type Row,
  type SyncTable,
  type Tables,
} from './tables'

// ============================================================
// FUSION À TROIS (fonctions pures, sans base de données)
//
// base   = état de la dernière synchro réussie (null : jamais synchronisé)
// local  = état actuel de cet appareil
// remote = état publié par les autres appareils
//
// Ligne par ligne, puis colonne par colonne : ce qui n'a changé que d'un
// côté depuis la base est repris tel quel. Une ligne absente d'un côté mais
// présente dans la base a été supprimée de ce côté. Un vrai conflit (même
// colonne modifiée des deux côtés) est tranché par l'horodatage de la ligne
// (le plus récent gagne), à défaut par le distant (déjà publié).
// Une modification l'emporte sur une suppression : rien n'est perdu.
// ============================================================

export interface SyncConflict {
  table: string
  key: string
  kind: 'field' | 'delete-vs-update'
  columns: string[]
  kept: 'local' | 'remote'
}

export interface MergeOutput {
  tables: Tables
  conflicts: SyncConflict[]
}

function newerSide(t: SyncTable, local: Row, remote: Row): 'local' | 'remote' {
  if (!t.stamp) return 'remote'
  const l = String(local[t.stamp] ?? '')
  const r = String(remote[t.stamp] ?? '')
  return l > r ? 'local' : 'remote'
}

function mergeRow(
  t: SyncTable,
  base: Row | undefined,
  local: Row,
  remote: Row,
  conflicts: SyncConflict[]
): Row {
  const out: Row = {}
  const conflicting: string[] = []
  const winner = newerSide(t, local, remote)
  const cols = new Set([...Object.keys(local), ...Object.keys(remote)])
  for (const c of cols) {
    // colonne absente d'un côté (appli plus ancienne) : considérée inchangée
    const b = base && c in base ? base[c] : undefined
    const hasBase = !!base && c in base
    const l = c in local ? local[c] : hasBase ? b : remote[c]
    const r = c in remote ? remote[c] : hasBase ? b : local[c]
    if (sameValue(l, r)) out[c] = l
    else if (hasBase && sameValue(l, b)) out[c] = r
    else if (hasBase && sameValue(r, b)) out[c] = l
    else if (c === t.stamp) out[c] = String(l ?? '') > String(r ?? '') ? l : r
    else {
      out[c] = winner === 'local' ? l : r
      conflicting.push(c)
    }
  }
  if (conflicting.length) {
    conflicts.push({
      table: t.name,
      key: keyOf(t, local),
      kind: 'field',
      columns: conflicting,
      kept: winner,
    })
  }
  return out
}

export function mergeTables(base: Tables | null, local: Tables, remote: Tables): MergeOutput {
  const tables: Tables = {}
  const conflicts: SyncConflict[] = []

  for (const t of SYNC_TABLES) {
    const B = indexRows(t, base?.[t.name])
    const L = indexRows(t, local[t.name])
    const R = indexRows(t, remote[t.name])
    const keys = new Set([...L.keys(), ...R.keys()])
    const rows: Row[] = []

    for (const k of keys) {
      const b = B.get(k)
      const l = L.get(k)
      const r = R.get(k)
      if (l && r) {
        rows.push(sameRow(l, r) ? l : mergeRow(t, b, l, r, conflicts))
      } else if (l || r) {
        const present = (l ?? r)!
        if (!b) {
          rows.push(present) // nouvelle ligne d'un seul côté
        } else if (!sameRow(present, b)) {
          // supprimée d'un côté, modifiée de l'autre : on garde la modification
          rows.push(present)
          conflicts.push({
            table: t.name,
            key: k,
            kind: 'delete-vs-update',
            columns: [],
            kept: l ? 'local' : 'remote',
          })
        }
        // sinon : supprimée d'un côté, inchangée de l'autre → supprimée
      }
    }
    tables[t.name] = rows
  }
  return { tables, conflicts }
}

// ============================================================
// RÉPARATION : chaque côté était cohérent, leur fusion peut ne pas l'être
// (une carte rangée sur le téléphone dans un conteneur supprimé sur le PC,
// deux cartes dans la même case de classeur, plus de copies rangées que
// d'exemplaires possédés…). On rétablit les règles de l'appli.
// ============================================================

export interface RepairOutput {
  tables: Tables
  fixes: number
}

const num = (v: unknown) => Number(v ?? 0)

export function repairTables(input: Tables, remote?: Tables): RepairOutput {
  const tables: Tables = Object.fromEntries(
    Object.entries(input).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))])
  )
  let fixes = 0
  const drop = (name: string, keep: (r: Row) => boolean) => {
    const before = tables[name]?.length ?? 0
    tables[name] = (tables[name] ?? []).filter(keep)
    fixes += before - tables[name]!.length
  }

  // 1. clés étrangères (parents traités avant les enfants, cf. SYNC_TABLES)
  for (const t of SYNC_TABLES) {
    for (const p of t.parents ?? []) {
      const ids = new Set((tables[p.table] ?? []).map((r) => String(r.id)))
      drop(t.name, (r) => ids.has(String(r[p.column])))
    }
  }

  // 2. une carte retirée de la collection n'est plus rangée nulle part
  const deleted = new Set(
    (tables.collection ?? []).filter((c) => c.deleted_at != null).map((c) => String(c.id))
  )
  for (const name of ['deckbox_cards', 'binder_slots', 'bulk_box_contents'])
    drop(name, (r) => !deleted.has(String(r.collection_id)))

  // 3. une seule carte par case de classeur (celle déjà publiée est gardée)
  const remoteSlots = new Set((remote?.binder_slots ?? []).map((r) => String(r.id)))
  const slotKey = (r: Row) => `${r.container_id}|${r.page}|${r.row}|${r.col}`
  const bySlot = new Map<string, Row>()
  for (const s of [...(tables.binder_slots ?? [])].sort(
    (a, b) => Number(remoteSlots.has(String(b.id))) - Number(remoteSlots.has(String(a.id)))
  )) {
    if (!bySlot.has(slotKey(s))) bySlot.set(slotKey(s), s)
  }
  const keptSlots = new Set([...bySlot.values()])
  drop('binder_slots', (r) => keptSlots.has(r))

  // 4. une collection reçue par joueur : la plus récemment reçue
  const shared = new Map<string, Row>()
  for (const s of tables.shared_collections ?? []) {
    const k = `${s.game}|${s.owner}`
    const cur = shared.get(k)
    if (!cur || String(s.received_at) > String(cur.received_at)) shared.set(k, s)
  }
  const keptShared = new Set([...shared.values()])
  drop('shared_collections', (r) => keptShared.has(r))

  // 5. pas plus de copies rangées que d'exemplaires (conteneurs actifs)
  const active = new Set(
    (tables.containers ?? []).filter((c) => c.deleted_at == null).map((c) => String(c.id))
  )
  for (const entry of tables.collection ?? []) {
    if (entry.deleted_at != null) continue
    const id = String(entry.id)
    const mine = (name: string, col: string) =>
      (tables[name] ?? []).filter(
        (r) => String(r.collection_id) === id && active.has(String(r[col]))
      )
    const bulk = mine('bulk_box_contents', 'container_id')
    const boxes = mine('deckbox_cards', 'deckbox_id')
    const slots = mine('binder_slots', 'container_id').sort(
      (a, b) => num(b.page) - num(a.page) || num(b.row) - num(a.row) || num(b.col) - num(a.col)
    )
    const assigned =
      bulk.reduce((s, r) => s + num(r.quantity), 0) +
      boxes.reduce((s, r) => s + num(r.quantity), 0) +
      slots.length
    let excess = assigned - num(entry.quantity)
    if (excess <= 0) continue
    fixes++
    const removed = new Set<Row>()
    for (const r of [...bulk, ...boxes]) {
      if (excess <= 0) break
      const take = Math.min(excess, num(r.quantity))
      r.quantity = num(r.quantity) - take
      excess -= take
      if (num(r.quantity) <= 0) removed.add(r)
    }
    for (const s of slots) {
      if (excess <= 0) break
      removed.add(s)
      excess--
    }
    for (const name of ['bulk_box_contents', 'deckbox_cards', 'binder_slots'])
      tables[name] = (tables[name] ?? []).filter((r) => !removed.has(r))
  }

  // 6. on ne propose pas à l'échange plus qu'on ne possède
  for (const entry of tables.collection ?? []) {
    if ('trade_qty' in entry && num(entry.trade_qty) > num(entry.quantity)) {
      entry.trade_qty = num(entry.quantity)
      fixes++
    }
  }

  return { tables, fixes }
}
