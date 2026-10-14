import { useCallback, useSyncExternalStore } from 'react'
import type { AiVaultScanProgress } from '../../../../shared/ai-vault-scan-progress'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostScope } from '../../../../shared/execution-host'

const MAX_PROGRESS_ENTRIES = 8
const progressByKey = new Map<string, AiVaultScanProgress>()
const requestedKeys = new Set<string>()
const pushedKeys = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function rememberKey(keys: Set<string>, scanKey: string): void {
  keys.delete(scanKey)
  keys.add(scanKey)
  while (keys.size > MAX_PROGRESS_ENTRIES) {
    const oldest = keys.values().next().value
    if (oldest === undefined) {
      break
    }
    keys.delete(oldest)
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function setProgress(scanKey: string, progress: AiVaultScanProgress | null): void {
  progressByKey.delete(scanKey)
  if (progress) {
    progressByKey.set(scanKey, progress)
  }
  while (progressByKey.size > MAX_PROGRESS_ENTRIES) {
    const oldest = progressByKey.keys().next().value
    if (oldest === undefined) {
      break
    }
    progressByKey.delete(oldest)
  }
  emit()
}

function ensureSubscribed(): void {
  if (subscribed) {
    return
  }
  subscribed = true
  window.api.aiVault.onScanProgress?.(({ scanKey, progress }) => {
    rememberKey(pushedKeys, scanKey)
    setProgress(scanKey, progress)
  })
}

function loadKey(scanKey: string): void {
  if (requestedKeys.has(scanKey)) {
    return
  }
  rememberKey(requestedKeys, scanKey)
  void window.api.aiVault
    .getScanProgress?.(scanKey)
    .then((progress) => {
      if (!pushedKeys.has(scanKey)) {
        setProgress(scanKey, progress)
      }
    })
    .catch(() => undefined)
}

/** Live progress follows the request key; settled progress also needs the applied result's ID. */
export function useAiVaultScanProgress(
  executionHostScope: ExecutionHostScope,
  scanKey: string,
  appliedScanId: string | undefined
): AiVaultScanProgress | null {
  const local = executionHostScope === LOCAL_EXECUTION_HOST_ID
  const subscribe = useCallback(
    (listener: () => void) => {
      if (local) {
        ensureSubscribed()
        loadKey(scanKey)
      }
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    [local, scanKey]
  )
  const snapshot = useCallback(() => {
    const progress = local ? progressByKey.get(scanKey) : undefined
    if (!progress) {
      return null
    }
    return progress.stage === 'finding' ||
      progress.stage === 'reading' ||
      progress.scanId === appliedScanId
      ? progress
      : null
  }, [appliedScanId, local, scanKey])
  return useSyncExternalStore(subscribe, snapshot)
}

export function resetAiVaultScanProgressStoreForTests(): void {
  progressByKey.clear()
  requestedKeys.clear()
  pushedKeys.clear()
  subscribed = false
  listeners.clear()
}
