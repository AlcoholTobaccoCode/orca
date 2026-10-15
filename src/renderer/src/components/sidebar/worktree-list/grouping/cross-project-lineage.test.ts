import { describe, expect, it } from 'vitest'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { repo, worktree, project, projectHostSetups } from '../../worktree-list-groups-test-fixtures'
import { makeProjectGroup } from '../../folder-workspace-composer-submit-fixtures'
import { getWorktreeRevealCollapsedGroupKeys } from '../navigation/worktree-reveal-group-keys'
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
  it('keeps separate checkout context when both rows belong to one project', () => {
    const grouping = {
      projects: [project],
      projectHostSetups: [repo, childRepo].map((checkout) => ({
        ...projectHostSetups[0]!,
        id: checkout.id,
        repoId: checkout.id,
        path: checkout.path,
        displayName: checkout.displayName
      }))
    }
    const rows = buildRows(
      'repo', [child, parent], repos, null, new Set(), undefined, undefined, undefined,
      lineageById, worktreeMap, true, undefined, [], new Set(), new Map(), new Map(), [], grouping
    )
    expect(rows.filter((row) => row.type === 'item').map((row) => row.projectContextLabel))
      .toEqual([undefined, childRepo.displayName])
  })

  it('ranks Recent by owning-project activity while keeping children in the displayed section', () => {
    const gammaRepo = { ...repo, id: 'gamma', displayName: 'Gamma' }
    const rows = buildRows(
      'repo',
      [
        { ...parent, lastActivityAt: 1 },
        { ...child, lastActivityAt: 100 },
        { ...worktree, id: 'other-beta', repoId: childRepo.id, lastActivityAt: 2 },
        { ...worktree, id: 'gamma', repoId: gammaRepo.id, lastActivityAt: 50 }
      ],
      new Map([...repos, [gammaRepo.id, gammaRepo]]),
      null, new Set(), undefined, undefined, 'recent', lineageById, worktreeMap, true
    )
    expect(rows.filter((row) => row.type === 'header').map((row) => row.repo?.id))
      .toEqual([childRepo.id, gammaRepo.id, repo.id])
    expect(rows.find((row) => row.type === 'item' && row.worktree.id === child.id))
      .toMatchObject({ sectionKey: `repo:${repo.id}`, depth: 1 })
  })

  it.each(['single-location', 'duplicate-in-groups'] as const)(
    'reveals the displayed ancestor section and its custom project groups (%s)',
    (pinnedDisplayPolicy) => {
      const group = makeProjectGroup()
      const parentRepo = { ...repo, projectGroupId: group.id }
      const shownParent = { ...parent, isPinned: pinnedDisplayPolicy === 'duplicate-in-groups' }
      const collapsedGroups = new Set([
        `repo:${repo.id}`, `repo:${childRepo.id}`, `project-group:${group.id}`,
        'workspace-lineage:parent'
      ])
      const keys = getWorktreeRevealCollapsedGroupKeys({
        worktree: child, worktrees: [shownParent, child], worktreeLineageById: lineageById,
        repoMap: new Map([...repos, [repo.id, parentRepo]]), defaultHostId: 'local',
        hostScopedGroups: false, collapsedGroups, groupBy: 'repo', pinnedDisplayPolicy,
        prCache: null, workspaceStatuses: [], settings: null, projectGroups: [group]
      })
      expect(keys).toEqual(expect.arrayContaining([
        `repo:${repo.id}`, `project-group:${group.id}`, 'workspace-lineage:parent'
      ]))
      expect(keys).not.toContain(`repo:${childRepo.id}`)
    }
  )

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
