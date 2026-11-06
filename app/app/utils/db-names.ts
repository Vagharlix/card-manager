const isDev = import.meta.env.DEV
const isTest = import.meta.env.VITE_TEST_MODE === 'true'

// Test builds use isolated *.test.db files so E2E never touches dev/prod data.
// VITE_TEST_MODE is injected at build time when compiling the test binary.
function dbName(base: string): string {
  if (isTest) return `sqlite:${base}.test.db`
  if (isDev) return `sqlite:${base}.dev.db`
  return `sqlite:${base}.db`
}

export const DB_NAMES = {
  user: dbName('user'),
  ygo: dbName('cards-ygo'),
} as const
