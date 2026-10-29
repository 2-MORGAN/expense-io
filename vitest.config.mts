import { configDefaults, defineConfig } from 'vitest/config'

// Tests sans infrastructure, lancés par `npm run test:unit` et `npm run check`
// (pre-push et job `check` de la CI) ; `npx vitest` les relance à chaque
// modification (ADR-005 §1, ADR-009) :
// - unit : règles pures, sans base, S3 ni serveur, dans un `*.test.ts` à côté
//   du code testé ;
// - components : composants React rendus dans jsdom avec Testing Library,
//   réseau simulé (`integration/support/fetch.ts`), dans un `*.test.tsx` à côté
//   du composant.
// Les `*.integration.test.ts` exigent Docker : vitest.integration.config.mts
// (`npm run test:integration`). Les E2E de `e2e/` relèvent de Playwright.

export default defineConfig({
  // Alias `@/*` lu dans tsconfig.json, comme pour Next.js.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'eslint.config.test.ts', '.claude/hooks/*.test.mjs'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['integration/support/dom.ts'],
        },
      },
    ],
    // `npm run test:coverage` : rapport texte + HTML (coverage/index.html) sur
    // tout src/, pour que chaque trou se voie ; `npm run test:integration --
    // --coverage` donne celui de la couche d'intégration. Sans seuil bloquant
    // (ADR-005).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/generated/**'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
})
