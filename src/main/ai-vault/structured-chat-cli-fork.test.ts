import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { prepareStructuredChatCliFork } from './structured-chat-cli-fork'
import { prepareLegacySharedCodexSessionResume } from '../codex/codex-legacy-session-resume'
import { AiVaultPrepareSessionResumeParams } from '../../shared/rpc-contract/ai-vault-params'

let root: string | undefined
const request = {
  sourceChat: { sessionId: 'session-alpha-1', workspaceId: 'workspace-1' },
  fork: true
} as const
const prepare = vi.fn(async () => ({ useRealCodexHome: false }))
function install(record: AgentSessionRecord, copy = vi.fn()) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: preparation reads only these host dependencies.
  setStructuredAgentSessionHost({
    deps: {
      store: { getRecord: () => record, listRecords: () => [record] },
      adapter: { copyConversation: copy },
      resolveWorkspacePath: async () => root,
      resolveLaunchEnv: () => ({})
    }
  } as never)
}
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  prepare.mockClear()
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

it('locates the current Codex rollout in its recorded home and materializes the selected home', async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-cli-fork-'))
  const home = join(root, 'codex-runtime-home', 'home')
  const system = join(root, 'system')
  const record = agentSessionRecordFixture()
  record.provider = 'codex'
  record.accountHome = { variable: 'CODEX_HOME', path: home }
  record.providerHandleChain = [
    {
      ...record.providerHandleChain[0]!,
      handle: { transport: 'codex-app-server', agent: 'codex', nativeId: 'obsolete' }
    },
    {
      ...record.providerHandleChain[0]!,
      linkId: 'latest',
      handle: { transport: 'codex-app-server', agent: 'codex', nativeId: 'current-conversation' }
    }
  ]
  const relative = join('2026', '10', '15', 'rollout-2026-10-15-current-conversation.jsonl')
  const source = join(home, 'sessions', relative)
  await mkdir(join(home, 'sessions', '2026', '10', '15'), { recursive: true })
  await writeFile(source, '{"saved":true}\n')
  install(record)
  const result = await prepareStructuredChatCliFork(request, async (args) => {
    expect(args.sessionId).toBe('current-conversation')
    expect(args.filePath).toBe(source)
    const prepared = await prepareLegacySharedCodexSessionResume(args, {
      isHostSystemDefaultRealHomeSelected: () => true,
      legacyCodexHomePath: home,
      systemCodexHomePath: system
    })
    // Production uses its system home; this fixture selects the same materialized home explicitly.
    return { ...prepared, useRealCodexHome: false, substituteCodexHome: system }
  })
  expect(result.cliForkSource).toMatchObject({
    sessionId: 'current-conversation',
    codexHome: system,
    filePath: join(system, 'sessions', relative),
    cwd: root
  })
})

it('copies OpenCode directly from the selected record and preserves its typed account and copy id', async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-cli-fork-'))
  const record = agentSessionRecordFixture()
  record.provider = 'opencode'
  record.accountHome = { kind: 'opencode', locator: { kind: 'unmanaged' } }
  record.providerHandleChain = [
    {
      ...record.providerHandleChain[0]!,
      handle: { agent: 'opencode', transport: 'acp', nativeId: 'ses_source' }
    }
  ]
  const copy = vi.fn(async () => ({ sessionId: 'ses_copy' }))
  install(record, copy)
  const result = await prepareStructuredChatCliFork(request, prepare)
  expect(copy).toHaveBeenCalledWith(
    expect.objectContaining({
      accountHome: record.accountHome,
      providerSessionId: 'ses_source',
      identity: expect.objectContaining({ sessionId: record.sessionId })
    })
  )
  expect(result.cliForkSource).toMatchObject({
    agent: 'opencode',
    sourceAgent: 'opencode2',
    sessionId: 'ses_copy'
  })
  expect(prepare).not.toHaveBeenCalled()
})

it('uses the Pi file handle and refuses a mismatched saved header or missing handle', async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-cli-fork-'))
  const filePath = join(root, '2026-10-15_12345678-abcd-1234-abcd-123456789abc.jsonl')
  const record = agentSessionRecordFixture()
  record.provider = 'pi'
  record.providerHandleChain = [
    {
      ...record.providerHandleChain[0]!,
      handle: { agent: 'pi', transport: 'jsonl-rpc', nativeId: filePath }
    }
  ]
  await writeFile(
    filePath,
    JSON.stringify({ type: 'session', id: '12345678-abcd-1234-abcd-123456789abc', cwd: root }) +
      '\n'
  )
  install(record)
  await expect(prepareStructuredChatCliFork(request, prepare)).resolves.toMatchObject({
    cliForkSource: { filePath, sessionId: '12345678-abcd-1234-abcd-123456789abc' }
  })
  await writeFile(filePath, JSON.stringify({ type: 'session', id: 'wrong', cwd: root }) + '\n')
  await expect(prepareStructuredChatCliFork(request, prepare)).rejects.toThrow('does not match')
  record.providerHandleChain = []
  await expect(prepareStructuredChatCliFork(request, prepare)).rejects.toThrow(
    'no saved conversation'
  )
})

it('refuses a foreign workspace or WSL record and rejects mixed chat/row requests', async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-cli-fork-'))
  const record = agentSessionRecordFixture()
  install(record)
  await expect(
    prepareStructuredChatCliFork(
      { ...request, sourceChat: { ...request.sourceChat, workspaceId: 'other' } },
      prepare
    )
  ).rejects.toThrow('on this host')
  record.location.wslDistro = 'Ubuntu'
  await expect(prepareStructuredChatCliFork(request, prepare)).rejects.toThrow('on this host')
  expect(
    AiVaultPrepareSessionResumeParams.safeParse({
      ...request,
      agent: 'claude',
      filePath: '/foreign'
    }).success
  ).toBe(false)
  expect(prepare).not.toHaveBeenCalled()
})
