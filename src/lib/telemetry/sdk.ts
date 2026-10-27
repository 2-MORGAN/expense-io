import { context, metrics, propagation, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import {
  defaultResource,
  detectResources,
  envDetector,
  hostDetector,
  processDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
} from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { metricExportIntervalMs, telemetryEnabled, type Env } from './config'
import { HttpServerMetricsProcessor, RedactionSpanProcessor, requestSampler } from './spans'

export interface Telemetry {
  /** Les métriques sont lues par ce compteur (voir `observeOutboxBacklog`). */
  meterProvider: MeterProvider
  /** Envoie ce qui reste en attente, puis arrête l'envoi : à appeler avant la sortie du processus. Sans effet la seconde fois. */
  shutdown(): Promise<void>
}

declare global {
  var __telemetry: Telemetry | undefined
}

/**
 * Démarre traces, métriques et journaux OpenTelemetry, envoyés en OTLP/HTTP au
 * collecteur de `OTEL_EXPORTER_OTLP_ENDPOINT` (ADR-007). Sans collecteur
 * configuré, ne fait rien et rend `undefined`. Une seule fois par processus :
 * Next.js réévalue les modules en dev. Un collecteur injoignable n'interrompt
 * rien : les données de l'envoi en échec sont perdues.
 */
export function startTelemetry(serviceName: string, env: Env = process.env): Telemetry | undefined {
  if (!telemetryEnabled(env)) return undefined
  if (global.__telemetry) return global.__telemetry

  // `OTEL_RESOURCE_ATTRIBUTES` complète la ressource ; le nom du service reste
  // celui du processus (serveur ou worker). `service.instance.id`, tiré au
  // hasard à chaque démarrage, sépare deux processus du même service (un
  // second worker, plusieurs serveurs) : sans lui, leurs compteurs cumulés se
  // mélangeraient dans les mêmes séries.
  const resource = defaultResource()
    .merge(detectResources({ detectors: [envDetector, hostDetector, processDetector, serviceInstanceIdDetector] }))
    .merge(resourceFromAttributes({ 'service.name': serviceName, 'service.namespace': 'expense-io' }))

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: metricExportIntervalMs(env),
      }),
    ],
  })
  const tracerProvider = new TracerProvider({
    resource,
    sampler: requestSampler(),
    // Ordre voulu : le masquage passe avant la mesure et l'export.
    spanProcessors: [
      new RedactionSpanProcessor(),
      new HttpServerMetricsProcessor(meterProvider.getMeter('expense-io')),
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }),
    ],
  })
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  })

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  trace.setGlobalTracerProvider(tracerProvider)
  metrics.setGlobalMeterProvider(meterProvider)
  logs.setGlobalLoggerProvider(loggerProvider)

  // Requêtes SQL rattachées à une requête HTTP ou à un événement de l'outbox
  // (jamais leurs valeurs : `enhancedDatabaseReporting` reste à false) ;
  // boucle d'événements, mémoire et ramasse-miettes de Node.js.
  const unregister = registerInstrumentations({
    instrumentations: [new PgInstrumentation({ requireParentSpan: true }), new RuntimeNodeInstrumentation()],
    tracerProvider,
    meterProvider,
    loggerProvider,
  })

  let stopping: Promise<void> | undefined
  const telemetry: Telemetry = {
    meterProvider,
    shutdown() {
      stopping ??= (async () => {
        unregister()
        await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown(), loggerProvider.shutdown()])
      })()
      return stopping
    },
  }
  global.__telemetry = telemetry
  return telemetry
}
