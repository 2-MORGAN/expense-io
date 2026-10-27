import { createHash } from 'node:crypto'
import { withSystemTransaction } from '@/lib/db'

/**
 * Limite de tentatives de connexion (ADR-001 §4 point 3, AUTH-11) : au-delà
 * de `maxFailuresPerEmail` échecs pour une adresse (qu'elle ait un compte ou
 * non : pas d'énumération) ou de `maxFailuresPerIp` pour une adresse IP dans
 * une fenêtre de `windowSeconds`, la connexion est refusée jusqu'à la fin de
 * la fenêtre. Jamais de blocage définitif ; une connexion réussie ne remet
 * rien à zéro. Compteurs en base (table `login_attempts`), partagés entre
 * instances ; seuils réglables par l'environnement.
 */
export interface LoginThrottleConfig {
  maxFailuresPerEmail: number
  maxFailuresPerIp: number
  windowSeconds: number
}

export interface ThrottleKey {
  key: string
  limit: number
}

export interface AttemptRow {
  key: string
  failures: number
  windowEnd: Date
}

const DEFAULTS: LoginThrottleConfig = { maxFailuresPerEmail: 10, maxFailuresPerIp: 100, windowSeconds: 15 * 60 }

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loginThrottleConfig(env: Record<string, string | undefined> = process.env): LoginThrottleConfig {
  return {
    maxFailuresPerEmail: positiveInteger(env.LOGIN_MAX_FAILURES_PER_EMAIL, DEFAULTS.maxFailuresPerEmail),
    maxFailuresPerIp: positiveInteger(env.LOGIN_MAX_FAILURES_PER_IP, DEFAULTS.maxFailuresPerIp),
    windowSeconds: positiveInteger(env.LOGIN_WINDOW_SECONDS, DEFAULTS.windowSeconds),
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Clé d'une adresse email : insensible à la casse et aux espaces, jamais stockée en clair. */
export function emailKey(email: string): string {
  return digest(`email:${email.trim().toLowerCase()}`)
}

/**
 * Adresse du client telle que la transmet le proxy de l'hébergeur (première
 * entrée de `X-Forwarded-For`). Absente en local : seule la limite par email
 * s'applique alors.
 */
export function clientIp(headers: Headers | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers?.get('x-real-ip')?.trim() || null
}

export function throttleKeys(email: string, ip: string | null, config = loginThrottleConfig()): ThrottleKey[] {
  const keys = [{ key: emailKey(email), limit: config.maxFailuresPerEmail }]
  if (ip) keys.push({ key: digest(`ip:${ip}`), limit: config.maxFailuresPerIp })
  return keys
}

/** Secondes avant de pouvoir réessayer ; 0 si aucune clé n'a atteint son seuil. */
export function retryAfterSeconds(keys: ThrottleKey[], rows: AttemptRow[], now: Date): number {
  let wait = 0
  for (const row of rows) {
    const limit = keys.find((k) => k.key === row.key)?.limit
    if (limit === undefined || row.failures < limit || row.windowEnd <= now) continue
    wait = Math.max(wait, Math.ceil((row.windowEnd.getTime() - now.getTime()) / 1000))
  }
  return wait
}

/** Lecture seule, par `login_attempts_for` (SECURITY DEFINER) : avant `bcrypt.compare`, qui protège aussi le CPU. */
export async function loginRetryAfter(keys: ThrottleKey[]): Promise<number> {
  const result = await withSystemTransaction((client) =>
    client.query<{ key: string; failures: number; window_end: Date; checked_at: Date }>(
      'SELECT key, failures, window_end, checked_at FROM login_attempts_for($1::text[])',
      [keys.map((k) => k.key)]
    ))
  const now = result.rows[0]?.checked_at ?? new Date()
  return retryAfterSeconds(keys, result.rows.map((r) => ({ key: r.key, failures: r.failures, windowEnd: r.window_end })), now)
}

/** Un échec de plus sur chaque clé, par `record_login_failure` (SECURITY DEFINER). */
export async function recordLoginFailure(keys: ThrottleKey[], config = loginThrottleConfig()): Promise<void> {
  await withSystemTransaction((client) =>
    client.query('SELECT record_login_failure($1::text[], $2::int)', [keys.map((k) => k.key), config.windowSeconds]))
}
