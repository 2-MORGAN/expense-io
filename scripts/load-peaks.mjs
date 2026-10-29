// @ts-check
// Pics de charge (ADR-007, docs/observability.md) : des utilisateurs arrivent
// en nombre, puis repartent, pour voir dans Grafana ce que le serveur et le
// worker en font : débit et latence, 5xx, file de l'outbox et son retard, OCR,
// base de données, mémoire.
//
// Chaque utilisateur virtuel a son compte et joue les parcours de l'interface,
// avec les mêmes appels HTTP que le navigateur et un temps de réflexion entre
// deux gestes :
//  - salarié : consulte ses notes, ou saisit une note (reçu analysé par l'OCR,
//    suivi toutes les 300 ms comme `receiptAnalysisClient.ts`, puis envoi) ;
//  - manager : valide ou refuse les notes de son équipe, ou saisit la sienne ;
//  - RH : tranche les notes des managers, consulte les salariés.
// Profil : échauffement, puis `--peaks` fois montée, pic, descente et calme
// (le calme laisse voir le worker vider la file).
//
// Sans option : vérifie les prérequis (application, base, Grafana) et décrit le
// profil. `--execute` : crée une entreprise jetable `charge-<id>.load.test` (un
// RH, des managers, des salariés) avec le rôle propriétaire, comme le seed, car
// le rôle manager ne s'attribue qu'en base ; puis joue le profil. Ctrl+C arrête
// proprement et affiche le bilan.
// Options : --users=20 (utilisateurs au pic), --base=2 (au calme), --peaks=2,
// --peak-seconds=60.
// Application et base locales seulement ; mots de passe aléatoires jamais
// affichés ; `make clean` efface les comptes avec le reste des données locales.
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { config as loadEnv } from 'dotenv'
import { Pool } from 'pg'

loadEnv({ quiet: true })

/** @typedef {'employee' | 'manager' | 'hr_admin'} Role */
/** @typedef {{ email: string, role: Role }} Account */
/** @typedef {{ name: string, seconds: number, from: number, to: number }} Phase */
/** @typedef {{ status: number, body: string }} Reply */
/** @typedef {{ id: string, status: string }} Note */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const appUrl = new URL(process.env.APP_URL ?? 'http://localhost:3000')
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
const grafanaUrl = `http://localhost:${process.env.GRAFANA_PORT ?? '3001'}`
// Reçu lisible par l'OCR (montant, date, commerçant), celui des E2E.
const receipt = new Uint8Array(readFileSync(new URL('../e2e/fixtures/recu-ocr-complet.png', import.meta.url)))
const execute = process.argv.includes('--execute')

/**
 * @param {string} name
 * @param {number} fallback
 */
function option(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} attend un entier positif, reçu « ${raw} ».`)
    process.exit(1)
  }
  return value
}

const peakUsers = option('users', 20)
const baseUsers = Math.min(option('base', 2), peakUsers)
const peaks = option('peaks', 2)
const peakSeconds = option('peak-seconds', 60)

/** @type {Phase[]} */
const profile = [{ name: 'échauffement', seconds: 30, from: baseUsers, to: baseUsers }]
for (let i = 1; i <= peaks; i++) {
  profile.push(
    { name: `montée ${i}`, seconds: 20, from: baseUsers, to: peakUsers },
    { name: `pic ${i}`, seconds: peakSeconds, from: peakUsers, to: peakUsers },
    { name: `descente ${i}`, seconds: 10, from: peakUsers, to: baseUsers },
    { name: `calme ${i}`, seconds: 60, from: baseUsers, to: baseUsers }
  )
}
const totalSeconds = profile.reduce((sum, phase) => sum + phase.seconds, 0)

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Tirage dans [0, 1), pour les temps de réflexion et le choix des parcours. */
const random = () => randomInt(2 ** 47) / 2 ** 47
/**
 * @template T
 * @param {T[]} items
 * @returns {T}
 */
const pick = (items) => items[Math.floor(random() * items.length)]
const today = () => new Date().toISOString().slice(0, 10)
/** @param {number} count @param {string} word */
const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`

let stopping = false
let startedAt = 0
const elapsed = () => (performance.now() - startedAt) / 1000

/** Phase en cours et nombre d'utilisateurs visé, interpolé pendant une montée ou une descente. */
function current() {
  let t = elapsed()
  for (const phase of profile) {
    if (t < phase.seconds) {
      return { phase, users: Math.round(phase.from + ((phase.to - phase.from) * t) / phase.seconds) }
    }
    t -= phase.seconds
  }
  return { phase: profile[profile.length - 1], users: 0 }
}

/** Temps de réflexion entre deux gestes, écourté à l'arrêt. */
async function think(factor = 1) {
  const end = performance.now() + factor * (500 + random() * 2000)
  while (!stopping && performance.now() < end) await sleep(Math.min(250, end - performance.now()))
}

// --- Mesures ---------------------------------------------------------------

/** @param {number[]} values @param {number} q */
function quantile(values, q) {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** @param {number} ms */
function duration(ms) {
  if (Number.isNaN(ms)) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

class Tally {
  count = 0
  /** @type {number[]} */
  durations = []
  /** @type {Record<string, number>} */
  statuses = {}
  /** @type {number[]} */
  ocrWaits = []
  /** @type {Record<string, number>} */
  ocrOutcomes = {}

  /** @param {number} status @param {number} ms */
  request(status, ms) {
    this.count += 1
    this.durations.push(ms)
    const family = status === 0 ? 'réseau' : `${Math.floor(status / 100)}xx`
    this.statuses[family] = (this.statuses[family] ?? 0) + 1
  }

  /** @param {string} outcome @param {number} ms */
  ocr(outcome, ms) {
    this.ocrOutcomes[outcome] = (this.ocrOutcomes[outcome] ?? 0) + 1
    if (outcome === 'suggérée') this.ocrWaits.push(ms)
  }

  failures() {
    return (this.statuses['5xx'] ?? 0) + (this.statuses['réseau'] ?? 0)
  }
}

let recent = new Tally()
/** @type {Map<string, Tally>} */
const byPhase = new Map()
/** @type {Map<string, Tally>} */
const byRoute = new Map()

/** @param {Map<string, Tally>} map @param {string} key */
function tally(map, key) {
  const found = map.get(key) ?? new Tally()
  map.set(key, found)
  return found
}

/** @param {string} route @param {number} status @param {number} ms */
function record(route, status, ms) {
  recent.request(status, ms)
  tally(byPhase, current().phase.name).request(status, ms)
  tally(byRoute, route).request(status, ms)
}

/** @param {string} outcome @param {number} ms */
function recordOcr(outcome, ms) {
  recent.ocr(outcome, ms)
  tally(byPhase, current().phase.name).ocr(outcome, ms)
}

// --- Client HTTP -------------------------------------------------------------

/** Navigateur minimal : cookies de session d'Auth.js, redirections non suivies. */
class Session {
  /** @type {Map<string, string>} */
  cookies = new Map()
  loggedIn = false

  /**
   * @param {Account} account
   * @param {string} password
   */
  constructor(account, password) {
    this.account = account
    this.password = password
  }

  /**
   * @param {string} route gabarit de la route, pour les mesures
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<Reply>}
   */
  async request(route, path, init = {}) {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '))
    }
    const started = performance.now()
    let status = 0
    let body = ''
    try {
      const response = await fetch(new URL(path, appUrl), {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      })
      status = response.status
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]
        const equals = pair.indexOf('=')
        this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1))
      }
      body = await response.text()
    } catch {
      // Délai dépassé ou connexion refusée : compté comme erreur réseau.
    }
    record(route, status, performance.now() - started)
    return { status, body }
  }

  /** Connexion par le fournisseur Credentials, comme `signInWithCredentials` des E2E. */
  async login() {
    const csrf = await this.request('GET /api/auth/csrf', '/api/auth/csrf')
    if (csrf.status !== 200) return
    const { csrfToken } = JSON.parse(csrf.body)
    const form = new URLSearchParams({ csrfToken, email: this.account.email, password: this.password, callbackUrl: '/expenses' })
    const reply = await this.request('POST /api/auth/callback/credentials', '/api/auth/callback/credentials', {
      method: 'POST',
      body: form,
    })
    this.loggedIn = reply.status === 302 && [...this.cookies.keys()].some((name) => name.endsWith('session-token'))
  }
}

/** @param {Reply} reply @returns {Note[]} */
function notes(reply) {
  if (reply.status !== 200) return []
  const parsed = JSON.parse(reply.body)
  return Array.isArray(parsed) ? parsed : []
}

function receiptForm() {
  const form = new FormData()
  form.set('receipt', new Blob([receipt], { type: 'image/png' }), 'recu.png')
  return form
}

// --- Parcours ----------------------------------------------------------------

/** @param {Session} session */
async function consultNotes(session) {
  await session.request('GET /expenses', '/expenses')
  await think()
  const list = notes(await session.request('GET /api/expense-notes', '/api/expense-notes'))
  if (list.length > 0 && random() < 0.5) {
    await think()
    await session.request('GET /api/expense-notes/[id]/receipt-url', `/api/expense-notes/${pick(list).id}/receipt-url`)
  }
}

/**
 * Suggestion OCR du reçu, comme l'interface : 202, puis suivi toutes les 300 ms,
 * abandonné au bout de 75 s. Un refus (503 quand la file d'analyses est
 * pleine) laisse saisir la note à la main.
 * @param {Session} session
 * @returns {Promise<{ amount?: number, expenseDate?: string, description?: string }>}
 */
async function suggestion(session) {
  const asked = performance.now()
  const started = await session.request('POST /api/receipt-analyses', '/api/receipt-analyses', {
    method: 'POST',
    body: receiptForm(),
    headers: { 'Idempotency-Key': randomUUID() },
  })
  if (started.status !== 202) {
    recordOcr(`refusée (${started.status || 'réseau'})`, 0)
    return {}
  }
  const { id } = JSON.parse(started.body)
  while (!stopping && performance.now() - asked < 75_000) {
    await sleep(300)
    const reply = await session.request('GET /api/receipt-analyses/[id]', `/api/receipt-analyses/${id}`)
    if (reply.status !== 200) break
    const analysis = JSON.parse(reply.body)
    if (analysis.status === 'succeeded') {
      recordOcr('suggérée', performance.now() - asked)
      return analysis.result ?? {}
    }
    if (analysis.status === 'failed') {
      recordOcr('échouée', performance.now() - asked)
      return {}
    }
  }
  // Un suivi coupé par l'arrêt du script n'est pas un abandon de l'utilisateur.
  if (!stopping) recordOcr('abandonnée', performance.now() - asked)
  return {}
}

/** @param {Session} session */
async function submitNote(session) {
  await session.request('GET /expenses', '/expenses')
  await think()
  const suggested = await suggestion(session)
  await think(2)
  const form = receiptForm()
  form.set('amount', (suggested.amount ?? 10 + random() * 90).toFixed(2))
  form.set('expenseDate', suggested.expenseDate ?? today())
  form.set('description', suggested.description ?? 'Déplacement client')
  // Même clé si l'envoi est repris après une erreur serveur (ADR-003 §4).
  const key = randomUUID()
  for (let attempt = 0; attempt < 2 && !stopping; attempt++) {
    const reply = await session.request('POST /api/expense-notes', '/api/expense-notes', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': key },
    })
    if (reply.status !== 0 && reply.status < 500) break
    await think()
  }
  await session.request('GET /api/expense-notes', '/api/expense-notes')
}

/**
 * @param {Session} session
 * @param {'manager' | 'hr'} scope
 * @param {number} max
 */
async function decide(session, scope, max) {
  const list = notes(await session.request(`GET /api/${scope}/expense-notes`, `/api/${scope}/expense-notes`))
  for (const note of list.filter((item) => item.status === 'pending').slice(0, max)) {
    if (stopping) return
    await think()
    await session.request(`GET /api/${scope}/expense-notes/[id]/receipt-url`, `/api/${scope}/expense-notes/${note.id}/receipt-url`)
    await think()
    const decision = random() < 0.8 ? 'approve' : 'reject'
    await session.request(`POST /api/${scope}/expense-notes/[id]/${decision}`, `/api/${scope}/expense-notes/${note.id}/${decision}`, {
      method: 'POST',
    })
  }
}

/** @param {Session} session */
async function journey(session) {
  const draw = random()
  switch (session.account.role) {
    case 'employee':
      return draw < 0.5 ? consultNotes(session) : submitNote(session)
    case 'manager':
      if (draw < 0.6) {
        await session.request('GET /manager', '/manager')
        await think()
        return decide(session, 'manager', 3)
      }
      return draw < 0.8 ? consultNotes(session) : submitNote(session)
    case 'hr_admin':
      await session.request('GET /hr', '/hr')
      await think()
      await session.request('GET /api/hr/users', '/api/hr/users')
      return decide(session, 'hr', 2)
  }
}

/**
 * Utilisateur virtuel : actif tant que son rang est sous le nombre visé.
 * @param {Session} session
 * @param {number} rank
 */
async function virtualUser(session, rank) {
  while (!stopping) {
    if (rank >= current().users) {
      await sleep(250)
      continue
    }
    if (!session.loggedIn) {
      await session.login()
      if (!session.loggedIn) {
        await think(2)
        continue
      }
    }
    await journey(session)
    await think()
  }
}

// --- Préparation -------------------------------------------------------------

/**
 * Entreprise jetable : un RH, un manager pour huit utilisateurs, des salariés
 * répartis entre les managers. Rangs entrelacés : au calme comme au pic, les
 * rôles restent dans les mêmes proportions.
 * @param {Pool} pool
 * @param {string} password
 * @returns {Promise<Account[]>}
 */
async function createAccounts(pool, password) {
  const domain = `charge-${Date.now().toString(36)}.load.test`
  // Coût bcrypt réduit, comme les fixtures E2E : la connexion est identique.
  const hash = await bcrypt.hash(password, 4)
  const managerCount = Math.max(1, Math.round(peakUsers / 8))
  const employeeCount = Math.max(1, peakUsers - managerCount - 1)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const company = await client.query('INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id', [
      domain.split('.')[0],
      domain,
    ])
    const companyId = company.rows[0].id
    /**
     * @param {string} name
     * @param {Role} role
     * @param {string | null} managerId
     */
    const insert = async (name, role, managerId) => {
      const email = `${name}@${domain}`
      const row = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role, manager_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [companyId, name, email, hash, role, managerId]
      )
      return { id: /** @type {string} */ (row.rows[0].id), email, role }
    }
    /** @type {(Account & { order: number })[]} */
    const accounts = [{ ...(await insert('rh', 'hr_admin', null)), order: 0.5 }]
    const managers = []
    for (let i = 0; i < managerCount; i++) {
      const manager = await insert(`manager${i + 1}`, 'manager', null)
      managers.push(manager)
      accounts.push({ ...manager, order: (i + 0.5) / managerCount })
    }
    for (let i = 0; i < employeeCount; i++) {
      const employee = await insert(`salarie${i + 1}`, 'employee', managers[i % managerCount].id)
      accounts.push({ ...employee, order: (i + 0.5) / employeeCount })
    }
    await client.query('COMMIT')
    console.log(`Entreprise ${domain} : 1 RH, ${plural(managerCount, 'manager')}, ${plural(employeeCount, 'salarié')}.`)
    return accounts.sort((a, b) => a.order - b.order).map(({ email, role }) => ({ email, role }))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Le script crée des comptes et envoie des centaines de requêtes : jamais ailleurs qu'en local. */
function refuseRemoteTargets() {
  if (!LOCAL_HOSTS.has(appUrl.hostname)) {
    throw new Error(`APP_URL vise ${appUrl.host} : ce script ne charge qu'une application locale.`)
  }
  const database = databaseUrl ? new URL(databaseUrl).hostname : ''
  if (!LOCAL_HOSTS.has(database)) {
    throw new Error(`MIGRATION_DATABASE_URL vise « ${database} » : ce script n'écrit que dans une base locale.`)
  }
}

/** Services qui envoient des métriques à Grafana, lus dans son Prometheus. */
async function servicesSeenByGrafana() {
  try {
    const health = await fetch(`${grafanaUrl}/api/health`, { signal: AbortSignal.timeout(3_000) })
    if (!health.ok) return null
    const query = encodeURIComponent('count by (service_name) ({service_name=~"expense-io-.*"})')
    const response = await fetch(`${grafanaUrl}/api/datasources/proxy/uid/prometheus/api/v1/query?query=${query}`)
    const { data } = await response.json()
    return /** @type {{ metric: { service_name: string } }[]} */ (data?.result ?? []).map((row) => row.metric.service_name)
  } catch {
    return null
  }
}

/** @param {Pool} pool */
async function checkPrerequisites(pool) {
  refuseRemoteTargets()
  const csrf = await fetch(new URL('/api/auth/csrf', appUrl), { signal: AbortSignal.timeout(30_000) }).catch(() => null)
  if (csrf?.status !== 200) throw new Error(`application injoignable sur ${appUrl.origin} : lancer make dev`)
  await pool.query('SELECT 1')
  const services = await servicesSeenByGrafana()
  if (services === null) {
    console.warn(`Grafana ne répond pas sur ${grafanaUrl} : make observability. Seule la console montrera la charge.`)
  } else if (!services.includes('expense-io-web') || !services.includes('expense-io-worker')) {
    console.warn(
      `Grafana ne reçoit rien de ${['expense-io-web', 'expense-io-worker'].filter((name) => !services.includes(name)).join(' ni de ')} :` +
        ' OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 dans .env, puis relancer make dev.'
    )
  } else {
    console.log(`Grafana reçoit les métriques du serveur et du worker : ${grafanaUrl}`)
  }
}

// --- Affichage ---------------------------------------------------------------

/** @param {Tally} t @param {number} seconds */
function line(t, seconds) {
  const statuses = Object.entries(t.statuses)
    .sort()
    .map(([family, count]) => `${family} ${count}`)
    .join('  ')
  const ocr = Object.entries(t.ocrOutcomes)
    .map(([outcome, count]) => `${outcome} ${count}`)
    .join(', ')
  return (
    `${(t.count / seconds).toFixed(1).padStart(5)} req/s  p50 ${duration(quantile(t.durations, 0.5)).padStart(7)}` +
    `  p95 ${duration(quantile(t.durations, 0.95)).padStart(7)}  ${statuses}` +
    (ocr ? `  | OCR : ${ocr}, attente p95 ${duration(quantile(t.ocrWaits, 0.95))}` : '')
  )
}

/** @param {number} seconds */
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

function summary() {
  console.log('\nBilan par phase')
  for (const phase of profile) {
    const t = byPhase.get(phase.name)
    if (t) console.log(`  ${phase.name.padEnd(13)} ${line(t, phase.seconds)}`)
  }
  console.log('\nRoutes les plus lentes (p95)')
  const routes = [...byRoute].sort(([, a], [, b]) => quantile(b.durations, 0.95) - quantile(a.durations, 0.95))
  for (const [route, t] of routes.slice(0, 8)) {
    const failures = t.failures() ? `, ${t.failures()} en échec` : ''
    console.log(`  ${route.padEnd(52)} ${String(t.count).padStart(5)} req  p95 ${duration(quantile(t.durations, 0.95))}${failures}`)
  }
}

// --- Programme ---------------------------------------------------------------

const pool = new Pool({ connectionString: databaseUrl, max: 2 })
try {
  await checkPrerequisites(pool)
  console.log(
    `\nProfil : ${plural(baseUsers, 'utilisateur')} au calme, ${peakUsers} au pic, ${plural(peaks, 'pic')} de ${peakSeconds} s, ` +
      `${clock(totalSeconds)} en tout.`
  )
  for (const phase of profile) console.log(`  ${phase.name.padEnd(13)} ${String(phase.seconds).padStart(3)} s  ${phase.from} → ${phase.to}`)
  if (!execute) {
    console.log('\nVérification seule. Pour jouer le profil : npm run load:peaks -- --execute')
  } else {
    const password = randomBytes(12).toString('base64url')
    const accounts = await createAccounts(pool, password)
    process.once('SIGINT', () => {
      console.log('\nArrêt demandé : fin des requêtes en cours…')
      stopping = true
    })
    const from = Date.now() - 60_000
    startedAt = performance.now()
    const users = accounts.map((account, rank) => virtualUser(new Session(account, password), rank))
    console.log(`\nSuivi en direct : ${grafanaUrl}/d/expense-io?from=${from}&to=now&refresh=10s\n`)
    while (!stopping && elapsed() < totalSeconds) {
      await sleep(5_000)
      const { phase, users: target } = current()
      console.log(`${clock(elapsed())}  ${phase.name.padEnd(13)} ${String(target).padStart(3)} util.  ${line(recent, 5)}`)
      recent = new Tally()
    }
    stopping = true
    await Promise.all(users)
    summary()
    console.log(
      `\nGrafana, de 1 min avant le début à maintenant : ${grafanaUrl}/d/expense-io?from=${from}&to=now\n` +
        'Le worker continue de vider la file après la fin du script : « Worker et outbox », « Retard du worker ».'
    )
  }
} catch (error) {
  console.error(`Charge interrompue : ${error instanceof Error ? error.message : error}`)
  console.error('Voir docs/observability.md, « Simuler des pics de charge ».')
  process.exitCode = 1
} finally {
  await pool.end()
}
