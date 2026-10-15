import { describe, expect, it } from 'vitest'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import { buildRows } from './build-rows'

const childRepo = { ...repo, id: 'child-repo', displayName: 'Child project', path: '/tmp/child' }
const repos = new Map([
  [repo.id, repo],
  [childRepo.id, childRepo]
])
const parent: Worktree = {
  ...worktree,
  id: 'parent',
  instanceId: 'parent-instance',
  isMainWorktree: true
}
const child: Worktree = {
  ...worktree,
  id: 'child',
  instanceId: 'child-instance',
  repoId: childRepo.id,
  path: '/tmp/child-worktree'
}
const lineage: WorktreeLineage = {
  worktreeId: child.id,
  worktreeInstanceId: 'child-instance',
  parentWorktreeId: parent.id,
  parentWorktreeInstanceId: 'parent-instance',
  origin: 'cli',
  capture: { source: 'terminal-context', confidence: 'inferred' },
  createdAt: 1
}
const lineageById = { [child.id]: lineage }
const worktreeMap = new Map([
  [parent.id, parent],
  [child.id, child]
])

describe('cross-project sidebar lineage', () => {
  it('nests under the visible parent while project actions keep real repository ownership', () => {
    const rows = buildRows(
      'repo',
      [child, parent],
      repos,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      lineageById,
      worktreeMap,
      true,
      undefined,
      [],
      new Set(),
      new Map([[childRepo.id, { repo: childRepo, hiddenWorktrees: [] }]]),
      new Map(),
      [{ creationId: 'creating-child', repoId: childRepo.id }]
    )

    const items = rows.filter((row) => row.type === 'item')
    expect(items.map((row) => [row.worktree.id, row.sectionKey, row.depth, row.repo?.id])).toEqual([
      [parent.id, `repo:${repo.id}`, 0, repo.id],
      [child.id, `repo:${repo.id}`, 1, childRepo.id]
    ])
    expect(items[1]?.projectContextLabel).toBe(childRepo.displayName)
    expect(
      rows.filter((row) => row.type === 'header').map((row) => [row.repo?.id, row.count])
    ).toEqual([
      [repo.id, 2],
      [childRepo.id, 0]
    ])
    const childSection = rows.findIndex(
      (row) => row.type === 'header' && row.repo?.id === childRepo.id
    )
    expect(rows.slice(childSection + 1).map((row) => row.type)).toEqual([
      'imported-worktrees-card',
      'pending-creation'
    ])
    expect(rows.find((row) => row.type === 'pending-creation')).toMatchObject({ repo: childRepo })
  })

  it('keeps a child in its own section when the parent is hidden', () => {
    const rows = buildRows(
      'repo',
      [child],
      repos,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      lineageById,
      worktreeMap,
      true
    )
    expect(rows.filter((row) => row.type === 'item')).toMatchObject([
      {
        worktree: child,
        sectionKey: `repo:${childRepo.id}`,
        depth: 0,
        projectContextLabel: childRepo.displayName
      }
    ])
  })
})
