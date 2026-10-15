import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import {
  getTopVisibleLineageRoots,
  getVisibleLineagePlacement
} from '../../../../shared/worktree-lineage-placement'
import {
  getCyclicProjectedWorktreeLineageIds,
  getSidebarLineageParent
} from './worktree-lineage-projection'

export function getSidebarLineageRowsByIdentity(
  worktrees: readonly Worktree[],
  worktreeMap: ReadonlyMap<string, Worktree>
): Map<string, Worktree> {
  return new Map(
    [...worktreeMap.values(), ...worktrees].map((worktree) => [
      getWorktreeHostIdentity(worktree),
      worktree
    ])
  )
}

function getSidebarLineageChildren(
  worktrees: readonly Worktree[],
  lineageById: Readonly<Record<string, WorktreeLineage>>,
  worktreeMap: ReadonlyMap<string, Worktree>
): Map<string, Worktree[]> {
  const rowsByIdentity = getSidebarLineageRowsByIdentity(worktrees, worktreeMap)
  const cyclicIds = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
  const childrenByParentIdentity = new Map<string, Worktree[]>()
  for (const child of rowsByIdentity.values()) {
    if (cyclicIds.has(child.id)) {
      continue
    }
    const parent = getSidebarLineageParent(child, lineageById, rowsByIdentity)
    if (!parent) {
      continue
    }
    const identity = getWorktreeHostIdentity(parent)
    const children = childrenByParentIdentity.get(identity) ?? []
    children.push(child)
    childrenByParentIdentity.set(identity, children)
  }
  return childrenByParentIdentity
}

/** A displayed row follows the highest ancestor that is also displayed. */
export function getTopVisibleLineageAncestorByIdentity(
  worktrees: readonly Worktree[],
  lineageById: Readonly<Record<string, WorktreeLineage>>,
  worktreeMap: ReadonlyMap<string, Worktree>
): Map<string, Worktree> {
  return getTopVisibleLineageRoots(
    worktrees,
    getSidebarLineageChildren(worktrees, lineageById, worktreeMap),
    getWorktreeHostIdentity
  )
}

// Why: pin is placement of the clicked row. Descendants keep their own isPinned
// and still follow a visible pinned ancestor into the Pinned section.
export function getPinnedSectionWorktrees(
  worktrees: readonly Worktree[],
  lineageById: Readonly<Record<string, WorktreeLineage>>,
  worktreeMap: ReadonlyMap<string, Worktree>
): Worktree[] {
  const placement = getVisibleLineagePlacement(
    worktrees,
    worktrees.filter((worktree) => worktree.isPinned),
    getSidebarLineageChildren(worktrees, lineageById, worktreeMap),
    getWorktreeHostIdentity,
    true
  )
  return worktrees.filter((worktree) => placement.has(getWorktreeHostIdentity(worktree)))
}

export function isPinnedSectionWorktree(
  worktree: Worktree,
  visibleWorktrees: readonly Worktree[],
  lineageById: Readonly<Record<string, WorktreeLineage>>,
  worktreeMap: ReadonlyMap<string, Worktree>
): boolean {
  if (worktree.isPinned) {
    return true
  }
  const identity = getWorktreeHostIdentity(worktree)
  return getPinnedSectionWorktrees(visibleWorktrees, lineageById, worktreeMap).some(
    (candidate) => getWorktreeHostIdentity(candidate) === identity
  )
}
