import { defineConfig } from 'vitest/config'

// Couche d'intégration (ADR-009) : `*.integration.test.ts`, contre le
// PostgreSQL, le S3 et le SMTP de docker-compose.yml. Le code testé se
// connecte sous le rôle restreint de l'application, la RLS s'applique
// (integration/setup.ts) ; les données sont créées sous le propriétaire, une
// entreprise par test. Docker requis : `make test-integration`, ou
// `make up migrate ensure-bucket` puis `npm run test:integration`. Lancé par
// le job `integration` de la CI. Les autres tests : vitest.config.mts.
export default defineConfig({
  // Alias `@/*` lu dans tsconfig.json, comme pour Next.js.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'integration',
    include: ['src/**/*.integration.test.ts', 'integration/**/*.integration.test.ts'],
    globalSetup: ['integration/global-setup.ts'],
    setupFiles: ['integration/setup.ts'],
    // Base, S3 et SMTP réels : plus lent qu'un test unitaire, jamais minuté au plus juste.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // `npm run test:integration -- --coverage` : ce que couvre cette couche,
    // sur le même périmètre que `npm run test:coverage`.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/generated/**'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
})
