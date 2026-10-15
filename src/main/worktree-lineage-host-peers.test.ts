import { describe, expect, it } from 'vitest'
import type { Repo } from '../shared/repo-types'
import type { WorktreeLineage } from '../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../shared/worktree/meta-types'
import type { ExecutionHostId } from '../shared/execution-host'
import { mergeWorktreeMetaForWrite } from './persistence/loading-store/worktree-meta-write-normalization'
import { mergeWorktree } from './ipc/worktree-metadata-merge'
import { projectWorktreeLineageWithHostPeers } from './worktree-lineage-host-peers'

function repo(id: string, hostId: 'local' | 'ssh:remote'): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: 'blue',
    addedAt: 1,
    executionHostId: hostId
  }
}

describe('per-repository lineage publication', () => {
  it('uses same-host stored peers when repository ids also exist on another host', () => {
    const childRepo = repo('child-repo', 'local')
    const localParentRepo = repo('parent-repo', 'local')
    const remoteParentRepo = repo('parent-repo', 'ssh:remote')
    const childId = 'child-repo::/child'
    const parentId = 'parent-repo::/parent'
    const childMeta = mergeWorktreeMetaForWrite(undefined, {
      hostId: 'local',
      instanceId: 'child-instance',
      projectId: 'child-project'
    })
    const localParentMeta = mergeWorktreeMetaForWrite(undefined, {
      hostId: 'local',
      instanceId: 'parent-instance',
      projectId: 'parent-project'
    })
    const remoteParentMeta = mergeWorktreeMetaForWrite(undefined, {
      hostId: 'ssh:remote',
      instanceId: 'remote-instance'
    })
    const localMeta: Record<string, WorktreeMeta> = {
      [childId]: childMeta,
      [parentId]: localParentMeta
    }
    const lineage: WorktreeLineage = {
      worktreeId: childId,
      worktreeInstanceId: 'child-instance',
      parentWorktreeId: parentId,
      parentWorktreeInstanceId: 'parent-instance',
      origin: 'cli',
      capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
      createdAt: 1
    }
    const store = {
      getRepos: () => [childRepo, localParentRepo, remoteParentRepo],
      getAllWorktreeMeta: () => localMeta,
      getAllWorktreeMetaForHost: (hostId: ExecutionHostId) =>
        hostId === 'local' ? localMeta : { [parentId]: remoteParentMeta },
      getAllWorktreeLineage: () => ({ [childId]: lineage })
    }
    const child = mergeWorktree(
      'child-repo',
      {
        path: '/child',
        head: '',
        branch: '',
        isBare: false,
        isMainWorktree: false
      },
      childMeta
    )
    const parent = mergeWorktree(
      'parent-repo',
      {
        path: '/parent',
        head: '',
        branch: '',
        isBare: false,
        isMainWorktree: false
      },
      localParentMeta
    )

    expect(projectWorktreeLineageWithHostPeers(store, childRepo, [child])).toMatchObject([
      { parentWorktreeId: parentId, lineage }
    ])
    expect(projectWorktreeLineageWithHostPeers(store, localParentRepo, [parent])).toMatchObject([
      { childWorktreeIds: [childId] }
    ])
  })
})
