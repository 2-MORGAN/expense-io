import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beforeSend,
  HEATMAP_PATHS,
  ocrSuggestionOutcome,
  recordsHeatmap,
  trackEvent,
  umamiScriptConfig,
  withoutQueryAndHash,
} from '@/components/analytics'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('umamiScriptConfig', () => {
  const configured = {
    UMAMI_SCRIPT_URL: 'http://localhost:3002/script.js',
    UMAMI_WEBSITE_ID: '5f3c0a1e-6d2b-4c8f-9a7e-1b2c3d4e5f60',
  }

  it('sans configuration, aucun script : le comportement par défaut ne change pas', () => {
    expect(umamiScriptConfig({})).toBeNull()
    expect(umamiScriptConfig({ UMAMI_SCRIPT_URL: configured.UMAMI_SCRIPT_URL })).toBeNull()
    expect(umamiScriptConfig({ UMAMI_WEBSITE_ID: configured.UMAMI_WEBSITE_ID })).toBeNull()
    expect(umamiScriptConfig({ ...configured, UMAMI_WEBSITE_ID: '  ' })).toBeNull()
  })

  it('refuse une adresse de script qui n’est pas http ou https', () => {
    expect(umamiScriptConfig({ ...configured, UMAMI_SCRIPT_URL: 'javascript:alert(1)' })).toBeNull()
    expect(umamiScriptConfig({ ...configured, UMAMI_SCRIPT_URL: 'pas une url' })).toBeNull()
  })

  it('configuré, ne mesure que sur l’hôte d’APP_URL', () => {
    expect(umamiScriptConfig({ ...configured, APP_URL: 'https://app.expense.io/' })).toEqual({
      src: 'http://localhost:3002/script.js',
      websiteId: configured.UMAMI_WEBSITE_ID,
      domains: 'app.expense.io',
    })
    expect(umamiScriptConfig(configured)?.domains).toBeUndefined()
  })

  it('heatmap seulement avec UMAMI_HEATMAP=true : recorder.js, servi par Umami à côté du script', () => {
    expect(umamiScriptConfig(configured)?.recorderSrc).toBeUndefined()
    expect(umamiScriptConfig({ ...configured, UMAMI_HEATMAP: 'false' })?.recorderSrc).toBeUndefined()
    expect(umamiScriptConfig({ ...configured, UMAMI_HEATMAP: 'true' })?.recorderSrc).toBe(
      'http://localhost:3002/recorder.js'
    )
    expect(
      umamiScriptConfig({
        ...configured,
        UMAMI_SCRIPT_URL: 'https://cloud.umami.is/script.js',
        UMAMI_HEATMAP: 'true',
      })?.recorderSrc
    ).toBe('https://cloud.umami.is/recorder.js')
    expect(umamiScriptConfig({ UMAMI_WEBSITE_ID: configured.UMAMI_WEBSITE_ID, UMAMI_HEATMAP: 'true' })).toBeNull()
  })
})

describe('recordsHeatmap', () => {
  it('mesure les pages de travail, qui ne portent aucun jeton dans leur adresse', () => {
    for (const path of HEATMAP_PATHS) expect(recordsHeatmap(path)).toBe(true)
  })

  it('jamais les pages dont l’adresse peut porter un jeton, ni les autres', () => {
    for (const path of ['/signup', '/verify-email', '/login', '/signup/verify', '/', '/expenses/autre']) {
      expect(recordsHeatmap(path)).toBe(false)
    }
  })
})

describe('withoutQueryAndHash', () => {
  it('retire la chaîne de requête et le fragment', () => {
    expect(withoutQueryAndHash('http://localhost:3000/signup?invitation=secret')).toBe('http://localhost:3000/signup')
    expect(withoutQueryAndHash('/verify-email?token=secret#top')).toBe('/verify-email')
    expect(withoutQueryAndHash('/expenses#historique')).toBe('/expenses')
    expect(withoutQueryAndHash('/hr')).toBe('/hr')
  })
})

describe('beforeSend', () => {
  const pageview = {
    website: 'site',
    hostname: 'localhost',
    url: 'http://localhost:3000/signup?invitation=secret',
    referrer: 'https://mail.example/inbox?token=secret#message',
  }

  it('page vue : URL et référent sans chaîne de requête ni fragment', () => {
    expect(beforeSend('event', pageview)).toMatchObject({
      website: 'site',
      url: 'http://localhost:3000/signup',
      referrer: 'https://mail.example/inbox',
    })
  })

  it('jamais d’identification : identify annulé, identifiant retiré', () => {
    expect(beforeSend('identify', { ...pageview, id: 'hr@expense.io' })).toBeNull()
    expect(beforeSend('event', { ...pageview, id: 'hr@expense.io' })?.id).toBeUndefined()
  })

  it('événement de la liste : ses seules propriétés permises, avec leurs seules valeurs', () => {
    expect(beforeSend('event', { ...pageview, name: 'expense-note-submitted', data: { ocr: 'kept' } })?.data).toEqual({
      ocr: 'kept',
    })
    const cleaned = beforeSend('event', {
      ...pageview,
      name: 'expense-note-submitted',
      data: { ocr: 'hr@expense.io', email: 'hr@expense.io', amount: '42.50', constructor: 'x' },
    })
    expect(cleaned?.name).toBe('expense-note-submitted')
    expect(cleaned?.data).toBeUndefined()
  })

  it('événement hors liste, ou nom qui n’est pas une chaîne : rien ne part', () => {
    expect(beforeSend('event', { ...pageview, name: 'note-42-for-hr@expense.io' })).toBeNull()
    expect(beforeSend('event', { ...pageview, name: 'constructor' })).toBeNull()
    expect(beforeSend('event', { ...pageview, name: 42 })).toBeNull()
  })
})

describe('trackEvent', () => {
  it('sans le script d’Umami, ne fait rien', () => {
    expect(() => trackEvent({ name: 'invitation-sent' })).not.toThrow()
  })

  it('transmet le nom et les propriétés au script', () => {
    const track = vi.fn()
    vi.stubGlobal('umami', { track })
    trackEvent({ name: 'invitation-sent' })
    trackEvent({ name: 'expense-note-submitted', data: { ocr: 'edited' } })
    expect(track).toHaveBeenNthCalledWith(1, 'invitation-sent')
    expect(track).toHaveBeenNthCalledWith(2, 'expense-note-submitted', { ocr: 'edited' })
  })

  it('une erreur du script ne remonte pas à l’interface', async () => {
    vi.stubGlobal('umami', {
      track: () => {
        throw new Error('script en panne')
      },
    })
    expect(() => trackEvent({ name: 'expense-note-started' })).not.toThrow()
    const rejected = vi.fn(() => Promise.reject(new Error('réseau coupé')))
    vi.stubGlobal('umami', { track: rejected })
    trackEvent({ name: 'expense-note-started' })
    await Promise.resolve()
    expect(rejected).toHaveBeenCalledOnce()
  })
})

describe('ocrSuggestionOutcome', () => {
  const submitted = { amount: '42.50', expenseDate: '2026-10-11', description: 'RESTAURANT LE TEST' }

  it('none : la suggestion n’a rempli aucun champ', () => {
    expect(ocrSuggestionOutcome({}, submitted)).toBe('none')
  })

  it('kept : chaque champ rempli garde sa valeur, montant comparé en nombre', () => {
    expect(ocrSuggestionOutcome({ amount: '42.5', expenseDate: '2026-10-11' }, submitted)).toBe('kept')
    expect(ocrSuggestionOutcome({ description: 'RESTAURANT LE TEST ' }, submitted)).toBe('kept')
  })

  it('edited : un champ rempli par la suggestion a changé avant l’envoi', () => {
    expect(ocrSuggestionOutcome({ amount: '42.5', expenseDate: '2026-10-10' }, submitted)).toBe('edited')
    expect(ocrSuggestionOutcome({ description: 'BOULANGERIE' }, submitted)).toBe('edited')
  })
})
