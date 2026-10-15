import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/lib/ipc-error'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { waitForPromiseWithSignal } from '../../../../shared/abort-signal-reason'
import {
  prepareNativeChatCliFork,
  type NativeChatCliForkSubject
} from '@/lib/native-chat-cli-fork-preparation'
import {
  assertAiVaultCopiedSessionLaunchAllowed,
  buildAiVaultCopiedSessionStartupForWorktree,
  buildAiVaultForkStartupForWorktree
} from '@/lib/ai-vault-session-fork-startup'
import { launchAiVaultSessionInNewTab } from '@/lib/launch-ai-vault-session'
import { notifyAiVaultSessionQueued } from '../right-sidebar/ai-vault-session-launch-feedback'
import {
  captureWebSessionIntentOwner,
  matchesWebSessionIntentOwner
} from '@/runtime/web-runtime-session-environment'
import {
  onRuntimeEnvironmentsRetired,
  onRuntimeEnvironmentRevisionsChanged
} from '@/runtime/runtime-environment-revision'
import type { AiVaultAgent } from '../../../../shared/ai-vault-types'
import { resolveTabSessionHistorySubject } from './tab-session-history-switch'

const pending = new Map<string, AbortController>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())
const keyFor = (subject: NativeChatCliForkSubject) =>
  `${subject.request.executionHostScope}\0${subject.sessionId}`
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNativeChatCliForkPending(subject: NativeChatCliForkSubject | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!subject && pending.has(keyFor(subject)),
    () => false
  )
}

export async function runNativeChatCliFork(args: {
  subject: NativeChatCliForkSubject
  tab: { id: string; worktreeId: string }
  agent: AiVaultAgent
  commandOverrides?: Partial<Record<AiVaultAgent, string | null>>
}): Promise<void> {
  const { subject, tab } = args
  const key = keyFor(subject)
  if (pending.has(key)) return
  const host = parseExecutionHostId(subject.request.executionHostScope)
  const owner = host?.kind === 'runtime' ? captureWebSessionIntentOwner(host.environmentId) : null
  const controller = new AbortController()
  const isCurrent = () => {
    if (controller.signal.aborted || (owner && !matchesWebSessionIntentOwner(owner))) return false
    const state = useAppStore.getState()
    const source = state.unifiedTabsByWorktree[tab.worktreeId]?.find((item) => item.id === tab.id)
    const current =
      source?.contentType === 'agent-session' && source.entityId === subject.sessionId
        ? resolveTabSessionHistorySubject(state, {
            tab,
            nativeChat: { sessionId: subject.sessionId, agent: args.agent }
          })
        : null
    return (
      current?.kind === 'chat' &&
      current.request.executionHostScope === subject.request.executionHostScope
    )
  }
  if (!isCurrent()) return
  const release = () => {
    if (pending.get(key) === controller) {
      pending.delete(key)
      changed()
    }
  }
  const abandon = () => {
    controller.abort()
    release()
  }
  pending.set(key, controller)
  changed()
  const stopSource = useAppStore.subscribe(() => {
    if (!isCurrent()) abandon()
  })
  const retire = (ids: readonly string[]) => {
    if (owner && ids.includes(owner.environmentId)) abandon()
  }
  const stopRetirement = onRuntimeEnvironmentsRetired(retire)
  const stopRevision = onRuntimeEnvironmentRevisionsChanged(retire)
  const stop = () => {
    stopSource()
    stopRetirement()
    stopRevision()
  }
  const timer = setTimeout(
    () => controller.abort(new Error('Conversation preparation timed out.')),
    30_000
  )
  try {
    const prepared = await waitForPromiseWithSignal(
      prepareNativeChatCliFork(subject, { pairingRevision: owner?.pairingRevision, isCurrent }),
      controller.signal
    )
    if (!isCurrent()) return
    const target = prepared.session
    const startupArgs = {
      state: useAppStore.getState(),
      worktreeId: subject.workspaceId,
      session: target,
      commandOverride: args.commandOverrides?.[target.agent]
    }
    assertAiVaultCopiedSessionLaunchAllowed(startupArgs)
    const startup = prepared.copied
      ? buildAiVaultCopiedSessionStartupForWorktree(startupArgs, prepared.sourceAgent ?? args.agent)
      : buildAiVaultForkStartupForWorktree(startupArgs)
    if (!startup) throw new Error('This session cannot be opened in the CLI.')
    // The destination takes over synchronously; closing the source afterward must not cancel it.
    if (!isCurrent()) return
    stop()
    clearTimeout(timer)
    const launch = launchAiVaultSessionInNewTab({
      agent: target.agent,
      worktreeId: subject.workspaceId,
      ...startup
    })
    if (launch.tabId === null) {
      const outcome = await launch.runtimeLaunch
      if (outcome.status === 'failed') throw new Error(outcome.message)
    }
    notifyAiVaultSessionQueued(target.agent)
  } catch (error) {
    if (pending.get(key) === controller) {
      toast.error(
        translate(
          'auto.components.right.sidebar.AiVaultPanel.resumeInNewCliFailed',
          'Could not resume this session in a new CLI.'
        ),
        { description: readIpcErrorMessage(error) }
      )
    }
  } finally {
    clearTimeout(timer)
    stop()
    release()
  }
}
