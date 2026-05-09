<template>
  <div style="padding: 2rem; font-family: monospace;">
    <h2>DB init test</h2>
    <pre>{{ output }}</pre>
  </div>
</template>
 
<script setup lang="ts">
import Database from '@tauri-apps/plugin-sql'
import { appDataDir } from '@tauri-apps/api/path'
 
const output = ref('')
const log = (msg: string) => {
  console.log(msg)
  output.value += msg + '\n'
}
 
onMounted(async () => {
  try {
    // Show where the files will be created
    const dir = await appDataDir()
    log(`App data dir: ${dir}`)
 
    // Load (and migrate) both databases
    log('\nOpening user.db...')
    const userDb = await Database.load('sqlite:user.db')
    log('user.db OK')
 
    log('\nOpening cards-ygo.db...')
    const ygoDb = await Database.load('sqlite:cards-ygo.db')
    log('cards-ygo.db OK')
 
    // Verify user.db tables exist
    log('\n--- user.db tables ---')
    const userTables = await userDb.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    )
    userTables.forEach(t => log(`  ${t.name}`))
 
    // Verify cards-ygo.db tables exist
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
