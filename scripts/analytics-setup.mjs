// Mesure d'usage (ADR-008, docs/analytics.md) : crée dans Umami le site
// « Expense.io » et son entonnoir s'ils n'existent pas encore, règle la heatmap,
// puis affiche les lignes à mettre dans .env. Idempotent. Lancé par
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

// Question « les entreprises inscrites vont-elles jusqu'à inviter un salarié ? »
// (ADR-008) : étapes franchies dans les 24 h par un même visiteur.
const funnel = {
  name: 'Inscription → invitation',
  parameters: {
    window: 24 * 60,
    steps: [
      { type: 'path', value: '/signup/verify' },
      { type: 'path', value: '/hr' },
      { type: 'event', value: 'invitation-sent' },
    ],
  },
}

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

try {
  const { token } = await umami('/api/auth/login', { body: { username, password } })
  const { data: websites } = await umami('/api/websites?pageSize=100', { token })
  const website =
    websites.find((site) => site.name === websiteName) ??
    (await umami('/api/websites', { token, body: { name: websiteName, domain: new URL(appUrl).hostname } }))

  await umami(`/api/websites/${website.id}`, { token, body: { replayConfig } })
  const { data: funnels } = await umami(`/api/websites/${website.id}/funnels`, { token })
  if (!funnels.some((existing) => existing.name === funnel.name)) {
    await umami(`/api/websites/${website.id}/funnels`, { token, body: funnel })
  }

  console.log(`Site « ${websiteName} » dans Umami : ${new URL('/websites/' + website.id, umamiUrl)}`)
  console.log(`Entonnoir « ${funnel.name} », heatmap activée, replays coupés.`)
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
