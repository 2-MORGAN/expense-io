import { defineConfig } from 'vitest/config'

// Tests unitaires (ADR-005 §1) : règles pures, sans base, S3 ni serveur,
// dans un fichier `*.test.ts` à côté du code testé. Les tests E2E de `e2e/`
// relèvent de Playwright (`npm run test:e2e`).
export default defineConfig({
  // Alias `@/*` lu dans tsconfig.json, comme pour Next.js.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'eslint.config.test.ts', '.claude/hooks/*.test.mjs'],
    // `npm run test:coverage` : rapport texte + HTML (coverage/index.html).
    coverage: {
      provider: 'v8',
      // Logique testée en unitaire (ADR-005 §1). Adaptateurs (Postgres, S3),
      // pages, composants et composition relèvent des E2E : hors périmètre.
      include: [
        'src/domain/**/*.ts',
        'src/application/**/*.ts',
        'src/http/**/*.ts',
        'src/lib/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
})
