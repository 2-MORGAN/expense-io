// Observabilité (ADR-007) : réglée par les variables standard d'OpenTelemetry.
// Ce module ne charge aucun paquet d'OpenTelemetry : `src/instrumentation.ts` le
// lit aussi pour le runtime edge.

export type Env = Readonly<Record<string, string | undefined>>

/**
 * La télémétrie ne démarre que si un collecteur est désigné par
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, et pas si `OTEL_SDK_DISABLED=true`. Sans
 * collecteur, rien n'est démarré et l'application se comporte comme avant.
 * Le point d'un signal (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`…) redirige ce
 * signal mais n'active rien seul : sinon les autres signaux, journal compris,
 * partiraient vers l'adresse par défaut que personne n'a choisie.
 */
export function telemetryEnabled(env: Env): boolean {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return false
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim())
}

// 60 s dans la spécification : 15 s rend les tableaux de bord vivants en local.
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 15_000

/** Intervalle d'envoi des métriques, en millisecondes : `OTEL_METRIC_EXPORT_INTERVAL`, 15 s par défaut. */
export function metricExportIntervalMs(env: Env): number {
  const value = Number(env.OTEL_METRIC_EXPORT_INTERVAL)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_METRIC_EXPORT_INTERVAL_MS
}
