import type { Repo } from '../../../../../../shared/repo-types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getSidebarLineageParent } from '../../worktree-lineage-projection'
import {
  getProjectGroupingForRepo,
  type ProjectGroupingIndex
} from '../../../../../../shared/project-section-grouping'

export function getWorktreeProjectContextLabel(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null | undefined,
  lineageById: Readonly<Record<string, WorktreeLineage>>,
  rowsByIdentity: ReadonlyMap<string, Worktree>,
  cyclicLineageIds: ReadonlySet<string>
): string | undefined {
  if (projectIndex === undefined || cyclicLineageIds.has(worktree.id)) {
    return undefined
  }
  const parent = getSidebarLineageParent(worktree, lineageById, rowsByIdentity)
  if (!parent) {
    return undefined
  }
  const project = getProjectGroupingForRepo(worktree.repoId, repoMap, projectIndex)
  const parentProject = getProjectGroupingForRepo(parent.repoId, repoMap, projectIndex)
  return project.key === parentProject.key ? undefined : project.label
}
