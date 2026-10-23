export interface RunWorkerOptions {
  /** Traite au plus un événement ; rend `true` s'il y en avait un (voir `processNextEvent`). */
  processNext: () => Promise<boolean>
  pollIntervalMs: number
  /** Demande d'arrêt : l'événement en cours est terminé, puis la boucle s'achève. */
  signal: AbortSignal
  onError: (error: unknown) => void
}

/** Attend `ms` millisecondes, ou rend la main dès que `signal` est déclenché. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * Boucle du worker : tant qu'un événement a été traité, on enchaîne aussitôt ;
 * quand il n'y a rien à faire, ou après une erreur (signalée à `onError`, qui
 * ne doit pas lever), on attend `pollIntervalMs` avant de réessayer, ce qui
 * évite de marteler une base en panne.
 */
export async function runWorker({ processNext, pollIntervalMs, signal, onError }: RunWorkerOptions): Promise<void> {
  while (!signal.aborted) {
    let didWork = false
    try {
      didWork = await processNext()
    } catch (error) {
      onError(error)
    }
    if (!didWork) await pause(pollIntervalMs, signal)
  }
}
