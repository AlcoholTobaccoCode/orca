import { describe, expect, it } from 'vitest'
import {
  applyMobileWorkspaceLineage,
  getMobileWorkspaceLineageGroupKey
} from './mobile-workspace-lineage'
import { buildSections, buildMobileWorkspacePlan, NO_PROJECT_SECTION_CATALOG, type Worktree } from './workspace-list-sections'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    workspaceKind: 'git',
    worktreeId: 'worktree',
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/mobile-parity',
    displayName: 'worktree',
    path: '/tmp/worktree',
    liveTerminalCount: 0,
    hasAttachedPty: false,
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: [],
    ...overrides
  }
}

describe('applyMobileWorkspaceLineage', () => {
  it.each([false, true])('keeps deep project identity in each occurrence (duplicate pins: %s)', (duplicate) => {
    const parent = worktree({ worktreeId: 'parent', isPinned: true })
    const child = worktree({
      worktreeId: 'child', repoId: 'repo-2', repo: 'Backend', parentWorktreeId: parent.worktreeId
    })
    const grandchild = { ...child, worktreeId: 'grandchild', parentWorktreeId: child.worktreeId }
    const filters = { filterRepoIds: new Set<string>(), hideSleeping: false, hideDefaultBranch: false }
    const plan = buildMobileWorkspacePlan(
      [grandchild, child, parent], 'name', filters, '', 'repo', new Set(),
      NO_PROJECT_SECTION_CATALOG, undefined, undefined, duplicate
    )
    const collapsed = new Set([getMobileWorkspaceLineageGroupKey(parent)])
    expect(plan.render(collapsed).flatMap((section) => section.data).map((row) => row.worktreeId))
      .toEqual(duplicate ? ['parent', 'parent'] : ['parent'])
    const sections = plan.render(new Set())
    expect(sections.map((section) => section.data.map((row) => [
      row.worktreeId, row.lineageDepth, row.projectContextLabel
    ]))).toEqual([
      [['parent', 0, 'orca'], ['child', 1, 'Backend'], ['grandchild', 2, 'Backend']],
      ...(duplicate ? [[['parent', 0, undefined], ['child', 1, 'Backend'], ['grandchild', 2, 'Backend']]] : [])
    ])
    const keys = sections.flatMap((section) => section.data.map((row) => row.sectionListKey))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('breaks inherited pins at hidden intermediate projects', () => {
    const parent = worktree({ worktreeId: 'parent', lastActivityAt: 1 })
    const child = worktree({
      worktreeId: 'child', repoId: 'repo-2', parentWorktreeId: 'parent', lastActivityAt: 100
    })
    const grandchild = worktree({
      worktreeId: 'grandchild', repoId: 'repo-3', parentWorktreeId: 'child', lastActivityAt: 50
    })
    const filters = { filterRepoIds: new Set<string>(), hideSleeping: false, hideDefaultBranch: false }
    const filtered = buildSections(
      [{ ...parent, isPinned: true }, child, grandchild], 'name',
      { ...filters, filterRepoIds: new Set(['repo-1', 'repo-3']) }, '', 'repo', new Set(), NO_PROJECT_SECTION_CATALOG
    )
    expect(filtered.map((section) => [section.key, section.data.map((row) => [row.worktreeId, row.lineageDepth])]))
      .toEqual([['pinned', [['parent', 0]]], ['repo:repo-3', [['grandchild', 0]]]])
  })

  it('places a visible child from another project under its same-host parent', () => {
    const parent = worktree({
      worktreeId: 'parent',
      displayName: 'parent',
      hostId: 'local',
      worktreeInstanceId: 'parent-instance'
    })
    const child = worktree({
      worktreeId: 'child',
      displayName: 'child',
      repoId: 'repo-2',
      repo: 'Backend',
      hostId: 'local',
      parentWorktreeId: 'parent',
      worktreeInstanceId: 'child-instance',
      lineageWorktreeInstanceId: 'child-instance',
      parentWorktreeInstanceId: 'parent-instance'
    })

    const rows = applyMobileWorkspaceLineage([child, parent])

    expect(rows.map((row) => row.worktreeId)).toEqual(['parent', 'child'])
    expect(rows.map((row) => row.lineageDepth)).toEqual([0, 1])
    expect(rows[0]?.lineageChildCount).toBe(1)
  })

  it('supports nested lineage chains', () => {
    const parent = worktree({ worktreeId: 'parent' })
    const child = worktree({ worktreeId: 'child', parentWorktreeId: 'parent' })
    const grandchild = worktree({ worktreeId: 'grandchild', parentWorktreeId: 'child' })

    const rows = applyMobileWorkspaceLineage([grandchild, child, parent])

    expect(rows.map((row) => row.worktreeId)).toEqual(['parent', 'child', 'grandchild'])
    expect(rows.map((row) => row.lineageDepth)).toEqual([0, 1, 2])
  })

  it('collapses descendants under lineage parents', () => {
    const parent = worktree({ worktreeId: 'parent' })
    const child = worktree({ worktreeId: 'child', parentWorktreeId: 'parent' })

    const rows = applyMobileWorkspaceLineage(
      [child, parent],
      new Set([getMobileWorkspaceLineageGroupKey(parent)])
    )

    expect(rows.map((row) => row.worktreeId)).toEqual(['parent'])
    expect(rows[0]?.lineageChildCount).toBe(1)
    expect(rows[0]?.lineageCollapsed).toBe(true)
  })

  it('keeps legacy host lineage nesting when instance ids are unavailable', () => {
    const parent = worktree({ worktreeId: 'parent' })
    const child = worktree({ worktreeId: 'child', parentWorktreeId: 'parent' })

    const rows = applyMobileWorkspaceLineage([child, parent])

    expect(rows.map((row) => row.worktreeId)).toEqual(['parent', 'child'])
  })

  it('does not nest stale lineage when instance ids no longer match', () => {
    const parent = worktree({ worktreeId: 'parent', worktreeInstanceId: 'new-parent-instance' })
    const child = worktree({
      worktreeId: 'child',
      parentWorktreeId: 'parent',
      worktreeInstanceId: 'child-instance',
      lineageWorktreeInstanceId: 'child-instance',
      parentWorktreeInstanceId: 'old-parent-instance'
    })

    const rows = applyMobileWorkspaceLineage([child, parent])

    expect(rows.map((row) => row.worktreeId)).toEqual(['child', 'parent'])
    expect(rows.map((row) => row.lineageDepth)).toEqual([0, 0])
  })

  it('keeps rows visible when lineage is cyclic', () => {
    const first = worktree({ worktreeId: 'first', parentWorktreeId: 'second' })
    const second = worktree({ worktreeId: 'second', parentWorktreeId: 'first' })

    const rows = applyMobileWorkspaceLineage([first, second])

    expect(rows.map((row) => row.worktreeId).sort()).toEqual(['first', 'second'])
  })

  it('keeps same-id rows on different hosts visible', () => {
    const local = worktree({ worktreeId: 'shared', hostId: 'local' })
    const remote = worktree({ worktreeId: 'shared', hostId: 'ssh:builder' })

    const rows = applyMobileWorkspaceLineage([local, remote])

    expect(rows.map((row) => row.hostId)).toEqual(['local', 'ssh:builder'])
  })
})
