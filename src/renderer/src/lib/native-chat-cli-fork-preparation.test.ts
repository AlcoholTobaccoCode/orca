import { afterEach, expect, it, vi } from 'vitest'
import {
  prepareNativeChatCliFork,
  type NativeChatCliForkSubject
} from './native-chat-cli-fork-preparation'
import { AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY } from '../../../shared/ai-vault-resume-preparation'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: call }))
afterEach(() => {
  call.mockReset()
  vi.unstubAllGlobals()
})
const subject: NativeChatCliForkSubject = {
  kind: 'chat',
  sessionId: 'chat-1',
  workspaceId: 'workspace-1',
  request: { executionHostScope: 'runtime:peer', scopePaths: ['/host/repo'], sessionLimit: 250 }
}
const source = {
  agent: 'claude',
  sourceAgent: 'claude',
  sessionId: 'provider-1',
  filePath: '/host/saved.jsonl',
  cwd: '/host/repo',
  codexHome: null,
  executionHostPlatform: 'linux'
}
const options = { pairingRevision: 7, isCurrent: () => true }

it('negotiates then prepares on the same paired host without requesting History', async () => {
  call
    .mockResolvedValueOnce({ capabilities: [AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY] })
    .mockResolvedValueOnce({ useRealCodexHome: false, cliForkSource: source })
  await expect(prepareNativeChatCliFork(subject, options)).resolves.toMatchObject({
    session: { sessionId: 'provider-1', executionHostId: 'runtime:peer' },
    copied: false
  })
  expect(call.mock.calls.map((args) => args[1])).toEqual([
    'status.get',
    'aiVault.prepareSessionResume'
  ])
  expect(call.mock.calls[1]).toEqual([
    { kind: 'environment', environmentId: 'peer' },
    'aiVault.prepareSessionResume',
    {
      sourceChat: { sessionId: 'chat-1', workspaceId: 'workspace-1' },
      executionHostId: 'runtime:peer',
      fork: true
    },
    expect.objectContaining({ expectedEnvironmentPairingRevision: 7 })
  ])
})

it('does not retry History after a capable host refuses or returns a malformed source', async () => {
  for (const result of [
    () => Promise.reject(new Error('Cannot read saved conversation')),
    () => Promise.resolve({ useRealCodexHome: false })
  ]) {
    call
      .mockResolvedValueOnce({ capabilities: [AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY] })
      .mockImplementationOnce(result)
    await expect(prepareNativeChatCliFork(subject, options)).rejects.toThrow()
  }
  expect(call.mock.calls.some((args) => args[1] === 'aiVault.listSessions')).toBe(false)
})

it('asks an old peer for one bounded same-host list and does not scan twice when absent', async () => {
  call
    .mockResolvedValueOnce({ capabilities: [] })
    .mockResolvedValueOnce({ sessions: [], issues: [], scannedAt: 'now' })
  await expect(prepareNativeChatCliFork(subject, options)).rejects.toThrow('no saved conversation')
  expect(call.mock.calls.map((args) => args[1])).toEqual(['status.get', 'aiVault.listSessions'])
  expect(call.mock.calls[1]?.[2]).toMatchObject({
    executionHostId: 'runtime:peer',
    force: undefined
  })
  expect(call.mock.calls[1]?.[3]).toMatchObject({
    expectedEnvironmentPairingRevision: 7,
    timeoutMs: 30_000
  })
})

it('does not prepare when the source retires during capability admission', async () => {
  call.mockResolvedValueOnce({ capabilities: [AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY] })
  await expect(
    prepareNativeChatCliFork(subject, { ...options, isCurrent: () => false })
  ).rejects.toThrow('source chat changed')
  expect(call).toHaveBeenCalledTimes(1)
})
