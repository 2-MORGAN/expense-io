// Mesure d'usage (ADR-008, docs/analytics.md) : crée dans Umami le site
// « Expense.io », ses entonnoirs et ses objectifs s'ils n'existent pas encore,
// règle la heatmap, puis affiche les lignes à mettre dans .env. Idempotent. Lancé par
// `make analytics`, après le démarrage de docker-compose.analytics.yml. Compte :
// celui qu'Umami crée à son premier démarrage (admin / umami), joignable sur
// localhost seulement.
import { config as loadEnv } from 'dotenv'

loadEnv({ quiet: true })

const umamiUrl = process.env.UMAMI_URL ?? `http://localhost:${process.env.UMAMI_PORT ?? '3002'}`
const username = process.env.UMAMI_USERNAME ?? 'admin'
const password = process.env.UMAMI_PASSWORD ?? 'umami'
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
const websiteName = 'Expense.io'

// Rapports des questions de l'ADR-008, retrouvés par leur nom. Entonnoirs :
// étapes franchies dans l'ordre par un même visiteur, en `window` minutes.
const funnels = [
  {
    // Les entreprises inscrites vont-elles jusqu'à inviter un salarié ?
    name: 'Inscription → invitation',
    parameters: {
      window: 24 * 60,
      steps: [
        { type: 'path', value: '/signup/verify' },
        { type: 'path', value: '/hr' },
        { type: 'event', value: 'invitation-sent' },
      ],
    },
  },
  {
    // Combien commencent une note sans l'envoyer ?
    name: 'Note commencée → envoyée',
    parameters: {
      window: 60,
      steps: [
        { type: 'event', value: 'expense-note-started' },
        { type: 'event', value: 'expense-note-submitted' },
      ],
    },
  },
]

// Part des visiteurs qui envoient une note, ou une invitation.
const goals = [
  { name: 'Note envoyée', parameters: { type: 'event', value: 'expense-note-submitted' } },
  { name: 'Invitation envoyée', parameters: { type: 'event', value: 'invitation-sent' } },
]

// Heatmap de toutes les sessions en local ; replays toujours coupés (ADR-008,
// amendement du 29/10). Le navigateur ne charge recorder.js qu'avec UMAMI_HEATMAP=true.
const replayConfig = { heatmapEnabled: true, heatmapSampleRate: 1, replayEnabled: false }

async function umami(path, { token, body } = {}) {
  const response = await fetch(new URL(path, umamiUrl), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`)
  return response.json()
}

/** Crée chaque rapport de `reports` absent de la liste `path` du site, par son nom. */
async function ensureReports(path, reports, token) {
  const { data: existing } = await umami(path, { token })
  for (const report of reports) {
    if (!existing.some((current) => current.name === report.name)) await umami(path, { token, body: report })
  }
}

try {
  const { token } = await umami('/api/auth/login', { body: { username, password } })
  const { data: websites } = await umami('/api/websites?pageSize=100', { token })
  // Hôte d'APP_URL, port compris : Umami affiche la page sous la heatmap en
  // chargeant ce domaine dans une iframe (`localhost` seul viserait le port 80).
  const domain = new URL(appUrl).host
  const website =
    websites.find((site) => site.name === websiteName) ??
    (await umami('/api/websites', { token, body: { name: websiteName, domain } }))

  await umami(`/api/websites/${website.id}`, { token, body: { domain, replayConfig } })
  await ensureReports(`/api/websites/${website.id}/funnels`, funnels, token)
  await ensureReports(`/api/websites/${website.id}/goals`, goals, token)

  const names = (reports) => reports.map((report) => `« ${report.name} »`).join(', ')
  console.log(`Site « ${websiteName} » dans Umami : ${new URL('/websites/' + website.id, umamiUrl)}`)
  console.log(`Entonnoirs ${names(funnels)} ; objectifs ${names(goals)}.`)
  console.log('Heatmap activée, replays coupés.')
  console.log('')
  console.log('À mettre dans .env, puis relancer make dev (ou npm run dev) :')
  console.log(`UMAMI_SCRIPT_URL=${new URL('/script.js', umamiUrl)}`)
  console.log(`UMAMI_WEBSITE_ID=${website.id}`)
  console.log('# En option, heatmap des pages /expenses, /manager et /hr :')
  console.log('UMAMI_HEATMAP=true')
} catch (error) {
  console.error(`Umami injoignable ou connexion refusée (${error.message}).`)
  console.error('Lancer d’abord : docker compose -f docker-compose.analytics.yml up -d --wait')
  process.exitCode = 1
}
