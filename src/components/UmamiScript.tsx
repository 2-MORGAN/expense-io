'use client'

import Script from 'next/script'
import { beforeSend, UMAMI_BEFORE_SEND, type UmamiScriptConfig } from '@/components/analytics'

// Le script d'Umami appelle cette fonction avant chaque envoi : elle est posée
// dès le chargement de ce module, donc avant le script lui-même.
if (typeof window !== 'undefined') Object.assign(window, { [UMAMI_BEFORE_SEND]: beforeSend })

/** Script de mesure d'usage (ADR-008), rendu par le layout seulement s'il est configuré. */
export function UmamiScript({ src, websiteId, domains }: UmamiScriptConfig) {
  return (
    <Script
      src={src}
      strategy="afterInteractive"
      data-website-id={websiteId}
      data-domains={domains}
      data-exclude-search="true"
      data-exclude-hash="true"
      data-before-send={UMAMI_BEFORE_SEND}
    />
  )
}
