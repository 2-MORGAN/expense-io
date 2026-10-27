import { describe, expect, it } from 'vitest'
import { metricExportIntervalMs, telemetryEnabled } from '@/lib/telemetry/config'

describe('telemetryEnabled', () => {
  it('désactivée sans collecteur configuré : le comportement par défaut ne change pas', () => {
    expect(telemetryEnabled({})).toBe(false)
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBe(false)
  })

  it('activée par le point d’envoi commun', () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).toBe(true)
  })

  it('le point d’un seul signal n’active rien : le journal ne part pas vers une adresse par défaut', () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces' })).toBe(false)
  })

  it('OTEL_SDK_DISABLED=true l’emporte sur un collecteur configuré', () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'TRUE' })).toBe(false)
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'false' })).toBe(true)
  })
})

describe('metricExportIntervalMs', () => {
  it('15 s par défaut, ou la valeur de OTEL_METRIC_EXPORT_INTERVAL', () => {
    expect(metricExportIntervalMs({})).toBe(15_000)
    expect(metricExportIntervalMs({ OTEL_METRIC_EXPORT_INTERVAL: '60000' })).toBe(60_000)
  })

  it('ignore une valeur invalide', () => {
    expect(metricExportIntervalMs({ OTEL_METRIC_EXPORT_INTERVAL: 'abc' })).toBe(15_000)
    expect(metricExportIntervalMs({ OTEL_METRIC_EXPORT_INTERVAL: '0' })).toBe(15_000)
    expect(metricExportIntervalMs({ OTEL_METRIC_EXPORT_INTERVAL: '-5' })).toBe(15_000)
  })
})
