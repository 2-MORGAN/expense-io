'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { beforeSend, recordsHeatmap, UMAMI_BEFORE_SEND, type UmamiScriptConfig } from '@/components/analytics'

// Le script d'Umami appelle cette fonction avant chaque envoi : elle est posée
// dès le chargement de ce module, donc avant le script lui-même.
if (typeof window !== 'undefined') Object.assign(window, { [UMAMI_BEFORE_SEND]: beforeSend })

/** Script de mesure d'usage (ADR-008), rendu par le layout seulement s'il est configuré. */
export function UmamiScript({ src, websiteId, domains, recorderSrc }: UmamiScriptConfig) {
  return (
    <>
      <Script
        src={src}
        strategy="afterInteractive"
        data-website-id={websiteId}
        data-domains={domains}
        data-exclude-search="true"
        data-exclude-hash="true"
        data-before-send={UMAMI_BEFORE_SEND}
      />
      {recorderSrc && <UmamiRecorder src={recorderSrc} websiteId={websiteId} />}
    </>
  )
}

/**
 * Heatmap (ADR-008, amendement du 29/10) : `recorder.js` sur les seules pages de
 * HEATMAP_PATHS. Chargé, il reste actif jusqu'au prochain chargement de page et
 * enverrait l'URL complète des pages suivantes : les quitter par une navigation
 * côté client recharge donc la page.
 */
function UmamiRecorder({ src, websiteId }: { src: string; websiteId: string }) {
  const recorded = recordsHeatmap(usePathname())
  const loaded = useRef(false)

  useEffect(() => {
    if (recorded) loaded.current = true
    else if (loaded.current) window.location.reload()
  }, [recorded])

  return recorded ? <Script src={src} strategy="afterInteractive" data-website-id={websiteId} /> : null
}
