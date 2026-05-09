<template>
  <div style="padding: 2rem; font-family: monospace;">
    <h2>DB init test</h2>
    <pre>{{ output }}</pre>
  </div>
</template>

<script setup lang="ts">
import Database from '@tauri-apps/plugin-sql'
import { appDataDir } from '@tauri-apps/api/path'
import { DB_NAMES } from '~/utils/db-names'

const output = ref('')
const log = (msg: string) => {
  console.log(msg)
  output.value += msg + '\n'
}

onMounted(async () => {
  try {
    const dir = await appDataDir()
    log(`App data dir: ${dir}`)

    log(`\nOpening ${DB_NAMES.user}...`)
    const userDb = await Database.load(DB_NAMES.user)
    log('user.db OK')

    log(`\nOpening ${DB_NAMES.ygo}...`)
    const ygoDb = await Database.load(DB_NAMES.ygo)
    log('cards-ygo.db OK')

    log('\n--- user.db tables ---')
    const userTables = await userDb.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    )
    userTables.forEach(t => log(`  ${t.name}`))

    log('\n--- cards-ygo.db tables ---')
    const ygoTables = await ygoDb.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    )
    ygoTables.forEach(t => log(`  ${t.name}`))

    log('\nAll good.')
  } catch (err) {
    log(`\nERROR: ${err}`)
  }
})
</script>