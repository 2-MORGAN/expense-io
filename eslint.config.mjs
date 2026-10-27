import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import sonarjs from 'eslint-plugin-sonarjs'

// Règles d'architecture de CLAUDE.md et des ADR-001 et 002, vérifiées par les
// règles natives d'ESLint (ADR-005, T6).
//
// Les listes LEGACY_* recensent le code existant qui enfreint encore une
// règle. Elles ne peuvent que raccourcir : retirer un fichier dès qu'il est
// conforme, ne jamais en ajouter un.
//
// Une règle configurée dans plusieurs blocs ne garde que les options du
// dernier bloc qui s'applique au fichier : les blocs `domain` et
// `routes-and-ui` reprennent donc les interdits globaux qui les concernent.

// Un segment dynamique de Next.js ([id]) se lirait comme une classe de
// caractères dans un motif glob.
const literal = (path) => path.replace(/[[\]]/g, '\\$&')

// Routes et server actions qui accèdent encore à la base. Chacune sort de la
// liste quand elle passe par un cas d'usage (2-488, ADR-002 §6).
export const LEGACY_DB_ACCESS = [
  'src/app/api/expense-notes/route.ts',
  'src/app/api/expense-notes/[id]/receipt-url/route.ts',
  'src/app/api/hr/expense-notes/route.ts',
  'src/app/api/hr/expense-notes/[id]/receipt-url/route.ts',
  'src/app/api/hr/users/route.ts',
  'src/app/api/hr/users/[id]/manager/route.ts',
  'src/app/api/manager/expense-notes/route.ts',
  'src/app/api/manager/expense-notes/[id]/receipt-url/route.ts',
].map(literal)

// Fichiers des appels à getPool() que 2-481 supprime (ADR-001, annexe B) :
// 12 à l'origine, 11 depuis la correction de S2 (2-471). La server action
// d'inscription en est sortie avec les invitations (2-496).
export const LEGACY_GET_POOL = [
  'src/app/api/expense-notes/route.ts',
  'src/app/api/hr/users/route.ts',
  'src/app/api/hr/users/[id]/manager/route.ts',
  'src/lib/auth.ts',
].map(literal)

// S1 : tri concaténé dans ORDER BY, jusqu'à sa correction (WS1).
export const LEGACY_SQL_INTERPOLATION = ['src/app/api/expense-notes/route.ts']

const GET_POOL_IMPORT = {
  group: ['**/lib/db', './db'],
  importNames: ['getPool'],
  message:
    'getPool() ne pose pas le contexte utilisateur dont dépend la RLS : il est réservé à src/lib/db.ts (ADR-001). Passer par withUserScope().',
}

const DB_ACCESS_IMPORT = {
  group: ['pg', '**/lib/db'],
  message:
    'Pas d’accès à la base dans une route, une server action ou l’UI : appeler un cas d’usage, qui passe par un repository (ADR-002 §3.3).',
}

// Un motif sans « / » vise ce nom à n'importe quel niveau du chemin :
// `lib` couvre `@/lib/db` comme `../../lib/db`, `next` couvre `next/server`.
const DOMAIN_IMPORT = {
  group: [
    'pg',
    'next',
    'next-auth',
    '@auth',
    '@aws-sdk',
    'tesseract.js',
    'react',
    'react-dom',
    'lib',
    'adapters',
    'application',
    'app',
    'components',
  ],
  message:
    'Le domaine reste pur : ni base, ni framework, ni SDK, ni couche applicative ou d’infrastructure (CLAUDE.md, ADR-002 §3.3). Passer par un port de src/ports/.',
}

// Mots-clés SQL en majuscules, comme dans tout le dépôt, et début d'une
// requête.
const SQL_KEYWORD = String.raw`\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER\s+BY|GROUP\s+BY|VALUES|SET|RETURNING|LIMIT|OFFSET)\b`
const SQL_STATEMENT = String.raw`^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\s`

const SQL_INTERPOLATION_MESSAGE =
  'SQL construit par interpolation ou concaténation : passer les valeurs en paramètres ($1, $2…) et choisir un tri ou une colonne dans une liste blanche (CLAUDE.md, règle 3).'

// Même détection sans tenir compte de la casse, mais seulement pour des
// formes d'une requête SQL (« select … from », « order by »…) : un mot isolé
// (« from », « set », « where ») est trop courant dans un message ou une
// classe CSS.
const SQL_PHRASE = String.raw`(\bselect\s[\s\S]*\sfrom\s|\binsert\s+into\s|\bdelete\s+from\s|\bupdate\s+\S+\s+set\s|\border\s+by\s|\bgroup\s+by\s)`

const SQL_INTERPOLATION = [
  {
    selector: `TemplateLiteral[expressions.length>0]:has(> TemplateElement[value.raw=/${SQL_KEYWORD}/])`,
    message: SQL_INTERPOLATION_MESSAGE,
  },
  {
    selector: `TemplateLiteral[expressions.length>0]:has(> TemplateElement[value.raw=/${SQL_PHRASE}/i])`,
    message: SQL_INTERPOLATION_MESSAGE,
  },
  {
    selector: `BinaryExpression[operator='+'] > Literal[value=/${SQL_KEYWORD}/]`,
    message: SQL_INTERPOLATION_MESSAGE,
  },
  {
    selector: `BinaryExpression[operator='+'] > Literal[value=/${SQL_PHRASE}/i]`,
    message: SQL_INTERPOLATION_MESSAGE,
  },
]

const SQL_TEXT = [
  {
    selector: `:matches(Literal[value=/${SQL_STATEMENT}/], TemplateElement[value.raw=/${SQL_STATEMENT}/])`,
    message:
      'Pas de SQL dans une route, une server action ou l’UI : il va dans un repository, appelé par un cas d’usage (ADR-002 §3.3).',
  },
]

const DISABLED_TEST_MESSAGE =
  'Un test ne se désactive pas pour faire passer la CI : corriger le code, ou demander si le comportement doit changer (ADR-005 §2).'

// Règles AWS CDK de SonarJS : le dépôt ne décrit pas d'infrastructure AWS en
// code, elles ne trouveraient rien et allongent le lint.
const SONARJS_AWS_CDK_OFF = Object.fromEntries(
  Object.keys(sonarjs.rules)
    .filter((name) => name.startsWith('aws-'))
    .map((name) => [`sonarjs/${name}`, 'off'])
)

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Règles de SonarQube (SonarJS) : bugs, failles (ReDoS, secrets en dur,
    // cookies, cryptographie…) et code fragile, vérifiés à chaque commit, push
    // et CI, sans serveur. Les constats du code existant sont figés dans
    // eslint-suppressions.json, qui ne fait que raccourcir. Seuls les
    // `plugins` et `rules` du préréglage sont repris : ses `settings`
    // changeraient la version de React vue par les règles de Next.js.
    name: 'expense-io/sonarjs',
    ignores: ['src/types/api.d.ts'], // généré par openapi-typescript
    plugins: sonarjs.configs.recommended.plugins,
    rules: { ...sonarjs.configs.recommended.rules, ...SONARJS_AWS_CDK_OFF },
  },
  {
    // Comptes de démonstration publics (CLAUDE.md, README) et données de test.
    name: 'expense-io/sonarjs-test-data',
    files: ['e2e/**', 'scripts/seed.mjs', 'src/**/*.test.ts'],
    rules: { 'sonarjs/no-hardcoded-passwords': 'off' },
  },
  {
    // Outils du poste de dev : npm et git lancés par leur nom, depuis le PATH.
    name: 'expense-io/sonarjs-dev-tools',
    files: ['.claude/hooks/**', 'scripts/**'],
    rules: { 'sonarjs/no-os-command-from-path': 'off' },
  },
  {
    name: 'expense-io/get-pool',
    ignores: ['src/lib/db.ts', ...LEGACY_GET_POOL],
    rules: {
      'no-restricted-imports': ['error', { patterns: [GET_POOL_IMPORT] }],
    },
  },
  {
    name: 'expense-io/sql-interpolation',
    ignores: LEGACY_SQL_INTERPOLATION,
    rules: {
      'no-restricted-syntax': ['error', ...SQL_INTERPOLATION],
    },
  },
  {
    // `lib` y interdit déjà tout src/lib/, getPool() compris.
    name: 'expense-io/domain',
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DOMAIN_IMPORT] }],
    },
  },
  {
    // L'interdit de `lib/db` couvre getPool() ; l'interpolation est reprise.
    name: 'expense-io/routes-and-ui',
    files: ['src/app/**', 'src/components/**', 'src/proxy.ts'],
    ignores: LEGACY_DB_ACCESS,
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_ACCESS_IMPORT] }],
      'no-restricted-syntax': ['error', ...SQL_INTERPOLATION, ...SQL_TEXT],
    },
  },
  {
    name: 'expense-io/tests',
    files: ['e2e/**', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'only', message: '.only n’exécute que ce test : le retirer avant de pousser.' },
        { property: 'skip', message: DISABLED_TEST_MESSAGE },
        { property: 'fixme', message: DISABLED_TEST_MESSAGE },
        { property: 'fail', message: DISABLED_TEST_MESSAGE },
        { property: 'fails', message: DISABLED_TEST_MESSAGE },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    // Rapports générés par les vérifications E2E locales.
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
