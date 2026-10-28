import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api'
import { MeterProvider, MetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace'
import { describe, expect, it } from 'vitest'
import {
  HttpServerMetricsProcessor,
  RedactionSpanProcessor,
  requestMetricAttributes,
  requestSampler,
  withoutQuery,
} from '@/lib/telemetry/spans'

/** Lecteur de métriques à la demande. */
class TestReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve()
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve()
  }
}

/** Un traceur dont les spans finis restent en mémoire, après les processeurs donnés. */
function tracerWith(...processors: SpanProcessor[]) {
  const exporter = new InMemorySpanExporter()
  const provider = new TracerProvider({ spanProcessors: [...processors, new SimpleSpanProcessor({ exporter })] })
  return { tracer: provider.getTracer('test'), exporter }
}

// Le span racine d'une requête tel que Next.js 16 le pose : méthode et cible
// au début (`BaseServer.handleRequest`), statut et route à la fin.
const NEXT_REQUEST = { 'next.span_type': 'BaseServer.handleRequest', 'next.span_name': 'GET', 'http.method': 'GET' }

describe('withoutQuery', () => {
  it('retire la chaîne de requête et le fragment', () => {
    expect(withoutQuery('/signup?invitation=abc#x')).toBe('/signup')
    expect(withoutQuery('/expenses#top')).toBe('/expenses')
    expect(withoutQuery('/api/expense-notes')).toBe('/api/expense-notes')
  })
})

describe('RedactionSpanProcessor (ADR-005 §5)', () => {
  it('un jeton de lien ou une signature d’URL ne part pas dans les traces', () => {
    const { tracer, exporter } = tracerWith(new RedactionSpanProcessor())
    const span = tracer.startSpan('GET', { attributes: { ...NEXT_REQUEST, 'http.target': '/verify-email?token=jeton-secret' } })
    span.setAttribute('http.url', 'http://localhost:4567/receipts/a.jpg?X-Amz-Signature=signature-secrete')
    span.end()

    const [exported] = exporter.getFinishedSpans()
    expect(exported.attributes['http.target']).toBe('/verify-email')
    expect(exported.attributes['http.url']).toBe('http://localhost:4567/receipts/a.jpg')
    expect(JSON.stringify(exported.attributes)).not.toMatch(/secret/)
  })

  it('nettoie le message et la pile d’une exception comme le journal', () => {
    const { tracer, exporter } = tracerWith(new RedactionSpanProcessor())
    const span = tracer.startSpan('POST /signup')
    const error = new Error('Key (email)=(jean.dupont@exemple.fr) already exists')
    span.recordException(error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    span.end()

    const [exported] = exporter.getFinishedSpans()
    expect(exported.events[0].attributes?.['exception.message']).toBe('Key (email)=([email]) already exists')
    expect(exported.events[0].attributes?.['exception.stacktrace']).toContain('spans.test.ts')
    expect(exported.status).toEqual({ code: SpanStatusCode.ERROR, message: 'Key (email)=([email]) already exists' })
    expect(JSON.stringify(exported.events)).not.toContain('jean.dupont')
  })
})

describe('requestMetricAttributes', () => {
  it('garde la méthode, le gabarit de route et le statut, sous les noms des conventions', () => {
    expect(requestMetricAttributes({
      ...NEXT_REQUEST, 'http.target': '/api/hr/expense-notes/3f1c/approve', 'http.status_code': 403,
      'http.route': '/api/hr/expense-notes/[id]/approve', 'next.route': '/api/hr/expense-notes/[id]/approve',
    })).toEqual({
      'http.request.method': 'GET', 'http.route': '/api/hr/expense-notes/[id]/approve', 'http.response.status_code': 403,
    })
  })

  it('ignore les autres spans et les requêtes sans route résolue', () => {
    expect(requestMetricAttributes({ 'next.span_type': 'AppRender.getBodyResult', 'http.route': '/expenses' })).toBeUndefined()
    expect(requestMetricAttributes({ ...NEXT_REQUEST, 'http.status_code': 200 })).toBeUndefined()
  })
})

describe('HttpServerMetricsProcessor', () => {
  it('mesure chaque requête de Next.js : http.server.request.duration', async () => {
    const reader = new TestReader()
    const meterProvider = new MeterProvider({ readers: [reader] })
    const { tracer } = tracerWith(new HttpServerMetricsProcessor(meterProvider.getMeter('test')))

    const request = tracer.startSpan('GET', { kind: SpanKind.SERVER, attributes: { ...NEXT_REQUEST, 'http.target': '/api/expense-notes' } })
    request.setAttributes({ 'http.status_code': 200, 'next.route': '/api/expense-notes', 'http.route': '/api/expense-notes' })
    request.end()
    // Ni un span interne de Next.js, ni la passe du proxy (sans route).
    tracer.startSpan('render route', { attributes: { 'next.span_type': 'AppRender.getBodyResult' } }).end()
    tracer.startSpan('GET', { attributes: NEXT_REQUEST }).end()

    const { resourceMetrics } = await reader.collect()
    const [metric] = resourceMetrics.scopeMetrics[0].metrics as HistogramMetricData[]
    expect(metric.descriptor).toMatchObject({ name: 'http.server.request.duration', unit: 's' })
    expect(metric.dataPoints).toHaveLength(1)
    expect(metric.dataPoints[0].attributes).toEqual({
      'http.request.method': 'GET', 'http.route': '/api/expense-notes', 'http.response.status_code': 200,
    })
    expect(metric.dataPoints[0].value.count).toBe(1)
  })

  it('compte aussi une requête dont l’appelant refuse l’échantillonnage (`traceparent` en -00), sans l’exporter', async () => {
    const reader = new TestReader()
    const meterProvider = new MeterProvider({ readers: [reader] })
    const exporter = new InMemorySpanExporter()
    const provider = new TracerProvider({
      sampler: requestSampler(),
      spanProcessors: [new HttpServerMetricsProcessor(meterProvider.getMeter('test')), new SimpleSpanProcessor({ exporter })],
    })
    const unsampled = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', traceFlags: TraceFlags.NONE, isRemote: true,
    })

    const request = provider.getTracer('next.js').startSpan('GET', { attributes: NEXT_REQUEST }, unsampled)
    request.setAttributes({ 'http.status_code': 500, 'http.route': '/api/expense-notes' })
    request.end()

    expect(exporter.getFinishedSpans()).toHaveLength(0)
    const { resourceMetrics } = await reader.collect()
    expect(resourceMetrics.scopeMetrics[0].metrics[0].dataPoints).toHaveLength(1)
  })
})
