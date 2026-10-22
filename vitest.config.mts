import { defineConfig } from 'vitest/config'

// Tests unitaires (ADR-005 §1) : règles pures, sans base, S3 ni serveur,
// dans un fichier `*.test.ts` à côté du code testé. Les tests E2E de `e2e/`
// relèvent de Playwright (`npm run test:e2e`).
export default defineConfig({
  // Alias `@/*` lu dans tsconfig.json, comme pour Next.js.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts', 'eslint.config.test.ts'],
  },
})
