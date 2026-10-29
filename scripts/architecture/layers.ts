// Couches du code et ce que chacune peut importer : la matrice de l'ADR-002
// (§3.3) et de AGENTS.md (« Où placer le code »), vérifiée par
// architecture.test.ts et dessinée dans docs/architecture/layers.mmd
// (`npm run generate:architecture`).
//
// Ajouter une couche ou un droit est une décision d'architecture, justifiée
// dans la PR (ADR-002). LEGACY_EDGES et PUBLIC_ROUTES ne font que raccourcir,
// comme les listes LEGACY_* de eslint.config.mjs : retirer une entrée dès
// qu'elle ne sert plus, ne jamais en ajouter une pour faire passer un test.

export type Group = 'entrees' | 'coeur' | 'infra'

export interface Layer {
  /** Dossier (`src/domain`) ou fichier sans extension (`src/lib/db` pour src/lib/db.ts). */
  path: string
  group: Group
  /** Nom dessiné, quand ce n'est pas le chemin sans `src/`. */
  label?: string
  /** Couches (par chemin) et paquets (par nom) que ce module peut importer. */
  may: readonly string[]
}

export interface ExternalPackage {
  name: string
  /** Noms de paquet npm ; `@scope/*` couvre tout un scope. */
  packages: readonly string[]
}

export interface LegacyEdge {
  from: string
  to: string
  why: string
}

// Ce qu'une entrée HTTP (route, server action, helper de src/http) peut
// appeler : cas d'usage, domaine, composition, et les briques transverses
// d'authentification, d'erreur et de journal. Ni SQL ni stockage direct.
const HTTP_ENTRY = [
  'src/application',
  'src/composition',
  'src/domain',
  'src/generated',
  'src/http',
  'src/lib/auth',
  'src/lib/authErrors',
  'src/lib/errors',
  'src/lib/log',
  'src/ports',
  'src/types',
  'src/utils',
  'next',
  'next-auth',
]

// L'interface lit les types du contrat HTTP (src/http, src/types, src/generated).
const UI = ['src/app/actions', 'src/domain', 'src/generated', 'src/http', 'src/types', 'src/utils', 'next', 'react']

export const LAYERS: readonly Layer[] = [
  // Entrées : HTTP, UI, worker. Elles appellent un cas d'usage (ADR-002 §3.3).
  { path: 'src/app/api', group: 'entrees', may: HTTP_ENTRY },
  { path: 'src/app/actions', group: 'entrees', may: HTTP_ENTRY },
  // Route hors de /api : le lien de vérification d'email (2-496).
  { path: 'src/app/verify-email', group: 'entrees', may: HTTP_ENTRY },
  // Pages : un composant serveur est une entrée côté serveur, comme une server
  // action ; il peut appeler un cas d'usage par la composition (ADR-002 §3.3,
  // amendement du 27/10). Jamais depuis un fichier 'use client'
  // (architecture.test.ts).
  {
    path: 'src/app',
    group: 'entrees',
    label: 'app (pages)',
    may: [...UI, 'src/components', 'src/composition', 'src/lib/auth', 'next-auth'],
  },
  { path: 'src/components', group: 'entrees', may: UI },
  { path: 'src/http', group: 'entrees', may: HTTP_ENTRY },
  { path: 'src/proxy', group: 'entrees', may: ['src/lib/auth', 'next', 'next-auth'] },
  // Au démarrage du serveur : observabilité (ADR-007), puis contrôles du secret
  // des sessions (S5, CONF-01) et du rôle de base (2-481).
  {
    path: 'src/instrumentation',
    group: 'entrees',
    may: ['src/lib/authSecret', 'src/lib/dbRole', 'src/lib/log', 'src/lib/telemetry', 'next'],
  },
  { path: 'src/types', group: 'entrees', may: ['next-auth'] },
  // Le worker est un processus à part, adaptateur entrant de l'outbox : il
  // fait aussi sa propre composition (ADR-003).
  {
    path: 'src/worker',
    group: 'entrees',
    may: [
      'src/adapters',
      'src/application',
      'src/composition',
      'src/domain',
      'src/lib/db',
      'src/lib/dbRole',
      'src/lib/email',
      'src/lib/log',
      'src/lib/outbox',
      'src/lib/telemetry',
      'src/lib/tokens',
      'src/ports',
      'src/utils',
      'pg',
    ],
  },

  // Cœur : règles pures et cas d'usage, sans infrastructure. Tout paquet
  // qu'il importe est jugé, déclaré dans PACKAGES ou non (`node:fs`, `zod`…).
  // Les cas d'usage tirent leurs identifiants de node:crypto (ReceiptAnalyses).
  { path: 'src/application', group: 'coeur', may: ['src/domain', 'src/ports', 'src/utils', 'node:crypto'] },
  { path: 'src/domain', group: 'coeur', may: ['src/generated', 'src/ports', 'src/utils'] },
  // Données générées depuis le contrat OpenAPI (2-486) : sans dépendance.
  { path: 'src/generated', group: 'coeur', may: [] },
  { path: 'src/ports', group: 'coeur', may: ['src/domain'] },
  { path: 'src/utils', group: 'coeur', may: [] },

  // Infrastructure : implémentations des ports et leur branchement.
  {
    path: 'src/composition',
    group: 'infra',
    may: [
      'src/adapters',
      'src/application',
      'src/domain',
      'src/lib/auth',
      'src/lib/db',
      'src/lib/email',
      'src/lib/log',
      'src/lib/outbox',
      'src/lib/storage',
      'src/lib/tokens',
      'src/ports',
      'src/utils',
    ],
  },
  {
    path: 'src/adapters',
    group: 'infra',
    may: [
      'src/domain',
      'src/lib/db',
      'src/lib/log',
      'src/lib/outbox',
      'src/lib/storage',
      'src/ports',
      'src/utils',
      '@aws-sdk',
      'nodemailer',
      'pg',
      'sharp',
      'tesseract.js',
    ],
  },
  {
    path: 'src/lib/auth',
    group: 'infra',
    may: [
      'src/domain',
      'src/lib/authErrors',
      'src/lib/db',
      'src/lib/log',
      'src/lib/loginThrottle',
      'src/lib/sessionUser',
      'next',
      'next-auth',
    ],
  },
  // Refus de démarrer avec un secret de session absent, faible ou d'exemple (S5, CONF-01).
  { path: 'src/lib/authSecret', group: 'infra', may: ['src/lib/log'] },
  // Échec de connexion d'un email non vérifié (2-496), partagé avec l'action de connexion.
  { path: 'src/lib/authErrors', group: 'infra', may: ['next-auth'] },
  { path: 'src/lib/db', group: 'infra', may: ['src/lib/log', 'pg'] },
  // Refus de démarrer sous un rôle qui contourne la RLS (S4, 2-481).
  { path: 'src/lib/dbRole', group: 'infra', may: ['src/lib/db', 'src/lib/log'] },
  // Fabrique de l'adaptateur SMTP (2-484).
  { path: 'src/lib/email', group: 'infra', may: ['src/adapters', 'src/lib/log', 'src/ports'] },
  // Réponses d'erreur HTTP : peut reprendre celles de src/http (ADR-004).
  { path: 'src/lib/errors', group: 'infra', may: ['src/http', 'src/lib/log', 'next'] },
  // Le journal part aussi au collecteur OpenTelemetry quand l'observabilité est activée (ADR-007).
  { path: 'src/lib/log', group: 'infra', may: ['@opentelemetry'] },
  // Limite de tentatives de connexion, compteurs en base (AUTH-11, ADR-001 §4 point 3).
  { path: 'src/lib/loginThrottle', group: 'infra', may: ['src/lib/db'] },
  { path: 'src/lib/outbox', group: 'infra', may: ['src/domain', 'src/lib/db', 'src/lib/log', 'src/ports', 'pg'] },
  // Rôle de la session relu en base à chaque auth() (2-496, S9).
  { path: 'src/lib/sessionUser', group: 'infra', may: ['src/domain', 'src/lib/db', 'react'] },
  { path: 'src/lib/storage', group: 'infra', may: ['src/domain', 'src/lib/log', '@aws-sdk'] },
  // Observabilité (ADR-007) : SDK OpenTelemetry, mesures HTTP et de l'outbox.
  { path: 'src/lib/telemetry', group: 'infra', may: ['src/lib/log', 'src/lib/outbox', '@opentelemetry'] },
  // Jetons des liens d'invitation et de vérification (node:crypto).
  { path: 'src/lib/tokens', group: 'infra', may: [] },
]

// Paquets dessinés : ceux qui font l'infrastructure ou le framework. Les
// autres (modules de Node, utilitaires) ne sont jugés que depuis le cœur.
export const PACKAGES: readonly ExternalPackage[] = [
  { name: '@aws-sdk', packages: ['@aws-sdk/*'] },
  { name: '@opentelemetry', packages: ['@opentelemetry/*'] },
  { name: 'next', packages: ['next'] },
  { name: 'next-auth', packages: ['next-auth', '@auth/*'] },
  { name: 'nodemailer', packages: ['nodemailer'] },
  { name: 'pg', packages: ['pg'] },
  { name: 'react', packages: ['react', 'react-dom'] },
  { name: 'sharp', packages: ['sharp'] },
  { name: 'tesseract.js', packages: ['tesseract.js'] },
]

// Flèches que la matrice interdit mais que le code a encore : dessinées en
// orange, tolérées jusqu'à leur correction. Vide depuis la migration des
// dernières routes par cas d'usage (ADR-006, 2-536) ; elle ne se remplit plus.
export const LEGACY_EDGES: readonly LegacyEdge[] = []

// Méthodes de route servies sans garde, par nature : `MÉTHODE /chemin`.
export const PUBLIC_ROUTES: readonly string[] = [
  // Auth.js : connexion, déconnexion et session.
  'GET /api/auth/[...nextauth]',
  'POST /api/auth/[...nextauth]',
  // Lien de l'email de vérification (2-496) : ouvert sans session, le jeton du lien fait la preuve.
  'GET /verify-email',
]
