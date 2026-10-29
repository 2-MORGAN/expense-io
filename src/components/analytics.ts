// Mesure d'usage du produit (ADR-008, docs/analytics.md). Ce module déclare les
// seuls événements envoyés à Umami, avec leurs propriétés et leurs valeurs
// permises, et contrôle tout ce qui part (beforeSend). Sans le script d'Umami,
// que le layout ne charge que s'il est configuré, rien ne part.

/** Événements et valeurs permises de leurs propriétés : la seule liste qui fait foi. */
export const ANALYTICS_EVENTS = {
  'expense-note-started': {},
  'expense-note-submitted': { ocr: ['kept', 'edited', 'none'] },
  'invitation-sent': {},
} as const

type Events = typeof ANALYTICS_EVENTS

type EventData<N extends keyof Events> = {
  -readonly [P in keyof Events[N]]: Events[N][P] extends readonly string[] ? Events[N][P][number] : never
}

export type AnalyticsEvent = {
  [N in keyof Events]: [keyof Events[N]] extends [never] ? { name: N } : { name: N; data: EventData<N> }
}[keyof Events]

export type OcrSuggestionOutcome = EventData<'expense-note-submitted'>['ocr']

/** Nom de la fonction que le script d'Umami appelle avant chaque envoi (`data-before-send`). */
export const UMAMI_BEFORE_SEND = 'expenseIoBeforeSend'

/** Ce que le script d'Umami s'apprête à envoyer : une page vue, ou un événement s'il porte un nom. */
export interface UmamiPayload {
  url?: string
  referrer?: string
  name?: unknown
  data?: Record<string, unknown>
  id?: string
  [field: string]: unknown
}

const ALLOWED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = ANALYTICS_EVENTS

/** URL sans chaîne de requête ni fragment : jetons d'invitation et de vérification, signatures (ADR-005 §5). */
export function withoutQueryAndHash(url: string): string {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

/**
 * Dernier contrôle de tout ce que le script d'Umami envoie (ADR-008 §2 et §4) :
 * URL et référent sans chaîne de requête ni fragment ; aucune identification ;
 * un événement absent de ANALYTICS_EVENTS ne part pas, une propriété ou une
 * valeur hors liste est retirée. `null` annule l'envoi.
 */
export function beforeSend(type: string, payload: UmamiPayload): UmamiPayload | null {
  // `identify` relierait les sessions d'une même personne.
  if (type !== 'event') return null
  const cleaned: UmamiPayload = { ...payload, id: undefined }
  if (typeof payload.url === 'string') cleaned.url = withoutQueryAndHash(payload.url)
  if (typeof payload.referrer === 'string') cleaned.referrer = withoutQueryAndHash(payload.referrer)
  if (payload.name === undefined) return cleaned
  if (typeof payload.name !== 'string' || !Object.hasOwn(ALLOWED, payload.name)) return null
  const allowed = ALLOWED[payload.name]
  const data = Object.fromEntries(
    Object.entries(payload.data ?? {}).filter(
      ([key, value]) => typeof value === 'string' && Object.hasOwn(allowed, key) && allowed[key].includes(value)
    )
  )
  return { ...cleaned, data: Object.keys(data).length > 0 ? data : undefined }
}

interface UmamiTracker {
  track: (name: string, data?: Record<string, string>) => unknown
}

/** Envoie un événement de ANALYTICS_EVENTS ; sans le script d'Umami, ne fait rien. */
export function trackEvent(event: AnalyticsEvent): void {
  const tracker = (globalThis as { umami?: Partial<UmamiTracker> }).umami
  if (typeof tracker?.track !== 'function') return
  try {
    const sent = 'data' in event ? tracker.track(event.name, event.data) : tracker.track(event.name)
    // La mesure ne gêne jamais l'interface : un envoi en échec est perdu.
    Promise.resolve(sent).catch(() => undefined)
  } catch {
    // Idem pour une erreur du script lui-même.
  }
}

/** Champs du formulaire de note, tels que saisis. */
export interface ReceiptFields {
  amount: string
  expenseDate: string
  description: string
}

const RECEIPT_FIELDS = ['amount', 'expenseDate', 'description'] as const

/**
 * Ce qu'est devenue la suggestion OCR à l'envoi de la note : `none` si elle n'a
 * rempli aucun champ, `kept` si chaque champ qu'elle a rempli garde sa valeur,
 * `edited` sinon. Le montant se compare en nombre : « 42.5 » vaut « 42.50 ».
 */
export function ocrSuggestionOutcome(
  suggested: Partial<ReceiptFields>,
  submitted: ReceiptFields
): OcrSuggestionOutcome {
  const filled = RECEIPT_FIELDS.filter((field) => suggested[field] !== undefined)
  if (filled.length === 0) return 'none'
  const kept = filled.every((field) =>
    field === 'amount'
      ? Number(suggested.amount) === Number(submitted.amount)
      : suggested[field]?.trim() === submitted[field].trim()
  )
  return kept ? 'kept' : 'edited'
}

/** Pages dont la heatmap enregistre les clics et le défilement (ADR-008, amendement du 29/10). */
export const HEATMAP_PATHS = ['/expenses', '/manager', '/hr'] as const

/**
 * Vrai si la heatmap mesure cette page. `recorder.js` envoie l'URL complète,
 * sans passer par beforeSend : il n'est chargé que sur des pages sans jeton
 * dans leur adresse, contrairement à `/signup?invitation=…`.
 */
export function recordsHeatmap(pathname: string): boolean {
  return (HEATMAP_PATHS as readonly string[]).includes(pathname)
}

/** Attributs du script d'Umami : son adresse, le site, l'hôte où il mesure, et le script de la heatmap. */
export interface UmamiScriptConfig {
  src: string
  websiteId: string
  domains?: string
  recorderSrc?: string
}

function parseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

/**
 * Le script n'est chargé que si `UMAMI_SCRIPT_URL` (http ou https) et
 * `UMAMI_WEBSITE_ID` sont définis (ADR-008 §1) ; il ne mesure alors que sur
 * l'hôte d'`APP_URL`, quand elle est définie. La heatmap s'y ajoute avec
 * `UMAMI_HEATMAP=true` : `recorder.js`, servi par Umami à côté de `script.js`.
 */
export function umamiScriptConfig(env: Readonly<Record<string, string | undefined>>): UmamiScriptConfig | null {
  const src = parseUrl(env.UMAMI_SCRIPT_URL)
  const websiteId = env.UMAMI_WEBSITE_ID?.trim()
  if (!src || (src.protocol !== 'http:' && src.protocol !== 'https:') || !websiteId) return null
  return {
    src: src.href,
    websiteId,
    domains: parseUrl(env.APP_URL)?.hostname,
    recorderSrc: env.UMAMI_HEATMAP?.trim() === 'true' ? new URL('recorder.js', src).href : undefined,
  }
}
