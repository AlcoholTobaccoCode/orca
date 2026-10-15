import { describe, expect, it, vi } from 'vitest'
import { flushBackgroundWork, mocks, repo, store } from './__mocks__/worktree-create-preparation'
import {
  consumePreparedWorktreeCreate,
  prepareWorktreeCreateForRepo
} from './worktree-create-preparation'
import {
  listPreparations,
  WORKTREE_CREATE_PREPARATION_TTL_MS
} from './worktree-create-preparation-pool'

function deferredFetch() {
  let settle!: () => void
  const beforeMaterialization = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { beforeMaterialization, settle }
}

function consume() {
  return consumePreparedWorktreeCreate({
    repoPath: repo.path,
    workspaceRoot: '/workspace',
    worktreePath: '/workspace/new',
    branch: 'new',
    baseBranch: 'origin/main'
  })
}

describe('prepared checkout shared fetch barrier', () => {
  it('passes initial materialization settlement separately from owning WSL Git options', async () => {
    mocks.getWorktreeOptions.mockReturnValue({ wslDistro: 'Ubuntu' })
    const fetch = deferredFetch()
    await prepareWorktreeCreateForRepo(store, repo, 'origin/main', fetch.beforeMaterialization)
    const entry = listPreparations()[0]!
    expect(mocks.prepareCheckout).toHaveBeenCalledWith(
      repo.path,
      entry.preparedPath,
      'refs/remotes/origin/main',
      entry.lockReason,
      { wslDistro: 'Ubuntu', signal: expect.any(AbortSignal) },
      fetch.beforeMaterialization
    )
    expect(mocks.refreshTip).not.toHaveBeenCalled()
    fetch.settle()
  })

  it('makes an existing checkout unclaimable as soon as a fetch-gated refresh is queued', async () => {
    await prepareWorktreeCreateForRepo(store, repo, 'origin/main')
    const fetch = deferredFetch()
    const preparation = prepareWorktreeCreateForRepo(
      store,
      repo,
      'origin/main',
      fetch.beforeMaterialization
    )
    await flushBackgroundWork()
    expect(await consume()).toMatchObject({ status: 'miss', reason: 'not_ready' })
    expect(mocks.refreshTip).not.toHaveBeenCalled()
    fetch.settle()
    await preparation
    expect(await consume()).toMatchObject({ status: 'hit' })
    expect(mocks.prepareCheckout).toHaveBeenCalledOnce()
    expect(mocks.refreshTip).toHaveBeenCalledOnce()
  })

  it('expires a ready checkout while its shared fetch is still pending without waiting for the network', async () => {
    vi.useFakeTimers()
    const fetch = deferredFetch()
    try {
      await prepareWorktreeCreateForRepo(store, repo, 'origin/main')
      const entry = listPreparations()[0]!
      const settled = Promise.allSettled([
        prepareWorktreeCreateForRepo(store, repo, 'origin/main', fetch.beforeMaterialization)
      ])
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(WORKTREE_CREATE_PREPARATION_TTL_MS)
      expect((await settled)[0]?.status).toBe('rejected')
      expect(mocks.refreshTip).not.toHaveBeenCalled()
      expect(mocks.discard).toHaveBeenCalledOnce()
      expect(mocks.discard).toHaveBeenCalledWith(
        repo.path,
        entry.preparedPath,
        {},
        entry.lockReason
      )
      expect(listPreparations()).toEqual([])
    } finally {
      fetch.settle()
      vi.useRealTimers()
    }
  })
})
