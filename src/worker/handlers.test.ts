import { describe, expect, it } from 'vitest'
import { appUrlFromEnv, buildHandlers } from '@/worker/handlers'

describe('appUrlFromEnv', () => {
  it('refuse une production sans APP_URL', () => {
    expect(() => appUrlFromEnv({ NODE_ENV: 'production' })).toThrow('APP_URL is not set')
  })

  it('utilise APP_URL en production', () => {
    expect(appUrlFromEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example.com' })).toBe('https://app.example.com')
  })

  it('retombe sur localhost hors production', () => {
    expect(appUrlFromEnv({})).toBe('http://localhost:3000')
    expect(appUrlFromEnv({ NODE_ENV: 'development' })).toBe('http://localhost:3000')
  })
})

describe('buildHandlers', () => {
  it('refuse une production sans SMTP_HOST', () => {
    expect(() => buildHandlers({ NODE_ENV: 'production', APP_URL: 'https://app.example.com' })).toThrow('SMTP_HOST is not set')
  })

  it('refuse une production sans APP_URL', () => {
    expect(() => buildHandlers({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com' })).toThrow('APP_URL is not set')
  })

  it('construit les handlers de notification en développement', () => {
    expect(Object.keys(buildHandlers({}))).toEqual(['expense_note.submitted', 'expense_note.decided'])
  })
})
