import { defineConfig, globalIgnores } from 'eslint/config'
import nextTs from 'eslint-config-next/typescript'
import sonarjs from 'eslint-plugin-sonarjs'

// Promesses oubliées dans le code serveur et les tests (audit des tests du
// 29/10) : une écriture, un envoi ou un événement d'outbox lancé sans `await`
// peut finir hors de sa transaction ou échouer en silence, et un
// `expect(…).rejects` non attendu laisse passer un test. Ces règles ont besoin
// des types (typescript-eslint), ce qui coûte environ 8 s de plus à chaque
// commit : elles tournent donc à part, par `npm run lint:promises`, lancé par
// `npm run check` (pre-push et CI), et non par le pre-commit.
//
// Seules ces deux règles sont actives ici : les autres restent celles de
// eslint.config.mjs (`npm run lint`), d'où la reprise de eslint-config-next
// avec ses règles coupées, pour son seul analyseur TypeScript, et de SonarJS
// sans règle, pour reconnaître les `eslint-disable` qui le citent. L'UI
// (`*.tsx`) n'y entre pas encore : ses chargements dans `useEffect` ne
// traitent pas une panne réseau, un sujet à part.
const NEXT_TS_RULES_OFF = Object.fromEntries(
  nextTs.flatMap((config) => Object.keys(config.rules ?? {})).map((rule) => [rule, 'off'])
)

export default defineConfig([
  ...nextTs,
  {
    name: 'expense-io/promesses',
    files: ['src/**/*.ts'],
    plugins: { sonarjs },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // Un `eslint-disable` d'une règle coupée ici sert dans eslint.config.mjs.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      ...NEXT_TS_RULES_OFF,
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  globalIgnores(['**/*.tsx', 'src/types/**']),
])
