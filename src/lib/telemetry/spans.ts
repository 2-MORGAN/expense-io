import type { Attributes, Histogram, Meter } from '@opentelemetry/api'
import {
  AlwaysOnSampler,
  createAlwaysRecordSampler,
  ParentBasedSampler,
  type ReadableSpan,
  type Sampler,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace'
import { describeError, describeStack } from '@/lib/log'

// Traitement des spans avant leur export (ADR-007).

/**
 * Toutes les traces sont gardées, sauf celles qu'un appelant marque non
 * échantillonnées (`traceparent` en `-00`). Ces spans sont tout de même
 * enregistrés, sans être exportés : la mesure HTTP compte chaque requête, et
 * un client ne peut pas en retirer une des métriques ni des alertes.
 */
export function requestSampler(): Sampler {
  return createAlwaysRecordSampler(new ParentBasedSampler({ root: new AlwaysOnSampler() }))
}

// Attributs d'URL posés par Next.js (`http.target`) ou par un client HTTP. Leur
// chaîne de requête peut porter un jeton (lien d'invitation `/signup?invitation=…`,
// de vérification `/verify-email?token=…`) ou la signature d'une URL
// pré-signée : elle ne quitte pas le serveur (ADR-005 §5).
const URL_ATTRIBUTES = ['http.target', 'http.url', 'url.full'] as const

/** Une URL ou un chemin sans sa chaîne de requête ni son fragment. */
export function withoutQuery(url: string): string {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

function redactUrls(span: Span): void {
  for (const key of URL_ATTRIBUTES) {
    const value = span.attributes[key]
    if (typeof value === 'string') span.setAttribute(key, withoutQuery(value))
  }
}

/**
 * Applique aux spans les règles du journal (ADR-005 §5) : URL sans chaîne de
 * requête, message et pile d'une exception nettoyés comme dans `logError`
 * (emails, identifiants de connexion, URL pré-signées masqués). Placé avant
 * l'export : `onEnding` s'exécute avant que le span ne soit figé.
 */
export class RedactionSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    redactUrls(span)
  }

  onEnding(span: Span): void {
    redactUrls(span)
    for (const event of span.events) {
      if (event.name !== 'exception' || !event.attributes) continue
      const { attributes } = event
      if (attributes['exception.message'] !== undefined)
        attributes['exception.message'] = describeError(String(attributes['exception.message']))
      if (attributes['exception.stacktrace'] !== undefined)
        attributes['exception.stacktrace'] = describeStack(String(attributes['exception.stacktrace']))
    }
    if (span.status.message) span.setStatus({ ...span.status, message: describeError(span.status.message) })
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

// Span racine d'une requête servie par Next.js (route, page ou server action).
const NEXT_REQUEST_SPAN = 'BaseServer.handleRequest'

/**
 * Attributs de la mesure HTTP pour le span racine d'une requête Next.js, aux
 * noms des conventions sémantiques d'OpenTelemetry ; `undefined` pour un autre
 * span. Seules les requêtes dont Next.js a résolu la route comptent : le
 * gabarit (`/api/expense-notes/[id]/approve`) garde peu de valeurs, jamais
 * un identifiant. Sans route : la passe du proxy (doublon de la requête),
 * les fichiers de `_next` en dev.
 */
export function requestMetricAttributes(attributes: Attributes): Attributes | undefined {
  const route = attributes['http.route']
  if (attributes['next.span_type'] !== NEXT_REQUEST_SPAN || typeof route !== 'string') return undefined
  const method = attributes['http.method']
  const status = attributes['http.status_code']
  return {
    'http.request.method': typeof method === 'string' ? method : '_OTHER',
    'http.route': route,
    ...(typeof status === 'number' ? { 'http.response.status_code': status } : {}),
  }
}

// Seuils de l'histogramme, en secondes : ceux conseillés par les conventions
// sémantiques, plus 30 et 60 s pour l'OCR (ADR-003 §1).
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10, 30, 60]

/**
 * Débit, erreurs et durée des requêtes HTTP (méthode RED), tirés des spans de
 * Next.js : `http.server.request.duration`, par méthode, route et statut.
 * Next.js ne publie pas de métrique ; ses spans portent déjà tout.
 */
export class HttpServerMetricsProcessor implements SpanProcessor {
  private readonly duration: Histogram

  constructor(meter: Meter) {
    this.duration = meter.createHistogram('http.server.request.duration', {
      description: 'Durée des requêtes HTTP servies par Next.js',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    })
  }

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const attributes = requestMetricAttributes(span.attributes)
    if (!attributes) return
    const [seconds, nanoseconds] = span.duration
    this.duration.record(seconds + nanoseconds / 1e9, attributes)
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
