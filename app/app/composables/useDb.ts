import Database from '@tauri-apps/plugin-sql'

let db: Database | null = null

export async function useDb() {
  if (db) return db

  db = await Database.load('sqlite:card-manager.db')

  await db.execute(`
    //todo
  `)

  return db
}