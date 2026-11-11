// ============================================================
// Compteur des écritures dans user.db (incrémenté par useDatabase). La
// synchro entre appareils s'en sert pour savoir, sans relire toutes les
// tables, que rien n'a été écrit ici depuis sa dernière réussite.
// Inactif (tests unitaires : useDatabase remplacé) → jamais de raccourci.
// ============================================================

let count = 0
let active = false

export function activateUserWrites(): void {
  active = true
}

export function noteUserWrite(): void {
  count++
}

// null : compteur inactif, on ne peut rien en conclure
export function userWrites(): number | null {
  return active ? count : null
}

// tests
export function resetUserWrites(isActive: boolean): void {
  count = 0
  active = isActive
}

// clé par laquelle la base de useDatabase donne sa version « non comptée »
export const UNCOUNTED = Symbol('uncounted')

// même base, mêmes requêtes, écritures non comptées : la synchro écrit sans
// « salir » la base. Une base sans cette version (tests) est rendue telle quelle.
export function uncounted<T extends object>(db: T): T {
  return ((db as Record<symbol, unknown>)[UNCOUNTED] as T | undefined) ?? db
}
