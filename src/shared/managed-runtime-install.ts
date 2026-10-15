// A runtime Orca installs for an agent only when the person asks, as its host reports it.

// The host answers managedRuntime.status, managedRuntime.install and managedRuntime.cancel.
export const MANAGED_RUNTIME_INSTALL_RUNTIME_CAPABILITY = 'managed-runtime.install.v1' as const

export type ManagedRuntimeOperation = {
  id: string
  kind: 'install' | 'remove'
  /** `cancelling` from an accepted Cancel until the work unwinds; then `cancelled`, or `succeeded`
   *  when it had already committed. */
  phase:
    | 'downloading'
    | 'extracting'
    | 'verifying'
    | 'removing'
    | 'cancelling'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  downloadedBytes: number
  totalBytes: number | null
  error?: string
}

export type ManagedRuntimeInstallState = {
  agent: string
  /** Rises with every change the host publishes, across operations. */
  revision: number
  /** The host has a pinned release; without one no Install is offered. */
  available: boolean
  version: string | null
  /** The pinned release's download size; absent without one. */
  downloadBytes?: number
  installedVersion: string | null
  /** False with an installed version: an update is available. */
  installedCurrent: boolean
  /** What a chat start runs now: Orca's release, a copy found outside it, or nothing. */
  source: 'managed' | 'external' | null
  /** The latest operation; an ended one stays readable until the next starts. */
  operation: ManagedRuntimeOperation | null
}
