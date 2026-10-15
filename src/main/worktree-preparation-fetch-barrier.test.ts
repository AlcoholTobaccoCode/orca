import { describe, expect, it } from 'vitest'
import { mocks, repo, store } from './__mocks__/worktree-create-preparation'
import {
  consumePreparedWorktreeCreate,
  prepareWorktreeCreateForRepo
} from './worktree-create-preparation'
import { listPreparations } from './worktree-create-preparation-pool'

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
    fetch.settle()
  })

  it('keeps a built checkout claimable when a later dialog open fetches again', async () => {
    await prepareWorktreeCreateForRepo(store, repo, 'origin/main')
    const fetch = deferredFetch()
    await prepareWorktreeCreateForRepo(store, repo, 'origin/main', fetch.beforeMaterialization)
    fetch.settle()
    expect(await consume()).toMatchObject({ status: 'hit' })
    expect(mocks.prepareCheckout).toHaveBeenCalledOnce()
  })
})
