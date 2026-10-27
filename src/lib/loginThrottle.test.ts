import { describe, expect, it } from 'vitest'
import { clientIp, emailKey, loginThrottleConfig, retryAfterSeconds, throttleKeys } from './loginThrottle'

// AUTH-11 (ADR-001 §4 point 3) : règles de la limite de tentatives, sans base.

const config = { maxFailuresPerEmail: 10, maxFailuresPerIp: 100, windowSeconds: 900 }
const now = new Date('2026-10-27T12:00:00Z')
const inSeconds = (s: number) => new Date(now.getTime() + s * 1000)

describe('limite de tentatives de connexion (AUTH-11)', () => {
  it('seuils par défaut : 10 échecs par email, 100 par IP, fenêtre de 15 min ; réglables par l’environnement', () => {
    expect(loginThrottleConfig({})).toEqual(config)
    expect(loginThrottleConfig({ LOGIN_MAX_FAILURES_PER_EMAIL: '3', LOGIN_WINDOW_SECONDS: '60' }))
      .toEqual({ ...config, maxFailuresPerEmail: 3, windowSeconds: 60 })
    expect(loginThrottleConfig({ LOGIN_MAX_FAILURES_PER_EMAIL: '0', LOGIN_MAX_FAILURES_PER_IP: 'abc' })).toEqual(config)
  })

  it('clé email : empreinte insensible à la casse et aux espaces, jamais l’adresse en clair', () => {
    expect(emailKey(' Demo@Expense.io ')).toBe(emailKey('demo@expense.io'))
    expect(emailKey('demo@expense.io')).toMatch(/^[0-9a-f]{64}$/)
    expect(emailKey('demo@expense.io')).not.toContain('demo')
  })

  it('IP : première entrée de X-Forwarded-For, sinon X-Real-IP, sinon aucune limite par IP', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
    expect(clientIp(new Headers())).toBeNull()
    expect(throttleKeys('a@b.c', null, config)).toHaveLength(1)
    expect(throttleKeys('a@b.c', '203.0.113.7', config).map((k) => k.limit)).toEqual([10, 100])
  })

  it('sous le seuil : aucune attente', () => {
    const keys = throttleKeys('a@b.c', null, config)
    expect(retryAfterSeconds(keys, [{ key: keys[0].key, failures: 9, windowEnd: inSeconds(600) }], now)).toBe(0)
  })

  it('seuil atteint : attendre la fin de la fenêtre', () => {
    const keys = throttleKeys('a@b.c', null, config)
    expect(retryAfterSeconds(keys, [{ key: keys[0].key, failures: 10, windowEnd: inSeconds(600.2) }], now)).toBe(601)
  })

  it('fenêtre expirée : plus de blocage (jamais définitif)', () => {
    const keys = throttleKeys('a@b.c', null, config)
    expect(retryAfterSeconds(keys, [{ key: keys[0].key, failures: 50, windowEnd: inSeconds(-1) }], now)).toBe(0)
  })

  it('seuil IP large : 10 échecs depuis une IP ne bloquent pas une autre adresse', () => {
    const keys = throttleKeys('autre@b.c', '203.0.113.7', config)
    expect(retryAfterSeconds(keys, [{ key: keys[1].key, failures: 10, windowEnd: inSeconds(600) }], now)).toBe(0)
    expect(retryAfterSeconds(keys, [{ key: keys[1].key, failures: 100, windowEnd: inSeconds(300) }], now)).toBe(300)
  })
})
