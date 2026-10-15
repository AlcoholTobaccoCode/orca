import {
  buildWorktreeOccurrencePlan,
  type WorktreeOccurrenceSection
} from '../../../src/shared/worktree-occurrence-plan'
import type { WorkspaceStatusDefinition } from '../../../src/shared/worktree/types'
import {
  DEFAULT_MOBILE_WORKSPACE_STATUSES,
  coerceMobileWorkspaceStatuses,
  getMobileWorkspaceStatus,
  getMobileWorkspaceStatusGroupKey
} from './mobile-workspace-statuses'
import {
  getMobileOccurrenceRows,
  getMobileWorkspaceLineageChildren
} from './mobile-workspace-lineage'
import { getPRGroupKey, PR_GROUP_LABELS, PR_GROUP_ORDER } from './workspace-pr-status-groups'
import type { FilterState, Section, SectionRepo, Worktree } from './workspace-list-types'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'
import { sortWorktrees } from './workspace-list-ordering'
import { getWorktreeRowIdentity } from './worktree-host-row-identity'
import {
  buildProjectGroupingIndex,
  buildProjectSections,
  getProjectGroupingForRepo,
  type ProjectSectionModel
} from '../../../src/shared/project-section-grouping'
import { withRepoSectionDisplayLabels } from '../../../src/shared/project-section-order'
import type { ProjectOrderBy } from '../../../src/shared/ui-chrome-types'

export type { FilterState, Section, SectionRepo, Worktree } from './workspace-list-types'

/** What Project grouping reads beyond the rows: the desktop's all-host catalog and header order. */
export type ProjectSectionCatalog = {
  /** Catalog repos of the hosts the list shows; each without rows gets an empty section. */
  repos: readonly SectionRepo[]
  /** Null until the desktop's catalog answers; rows then group by repo, as the desktop's would. */
  grouping: ProjectSectionModel | null
  /** Manual header rank; undefined keeps first-row order. */
  repoOrder: ReadonlyMap<string, number> | undefined
  projectOrderBy: ProjectOrderBy
}

export const NO_PROJECT_SECTION_CATALOG: ProjectSectionCatalog = {
  repos: [],
  grouping: null,
  repoOrder: undefined,
  projectOrderBy: 'manual'
}

/** Catalog repos by id, plus a stand-in from the row for a repo its host's catalog lacks. */
export function buildSectionRepoMap(
  catalogRepos: readonly SectionRepo[],
  worktrees: readonly Worktree[]
): Map<string, SectionRepo> {
  const repoMap = new Map(catalogRepos.map((repo) => [repo.id, repo]))
  for (const w of worktrees) {
    if (!repoMap.has(w.repoId)) {
      repoMap.set(w.repoId, {
        id: w.repoId,
        displayName: w.repo || 'Unknown',
        // Why: labels key on host + path, so a shared '' would let one stand-in rename another.
        path: w.repoId,
        executionHostId: w.hostId
      })
    }
  }
  return repoMap
}
export { CREATE_GRACE_MS, getWorktreeStatus, sortWorktrees } from './workspace-list-ordering'

function makeSection(
  key: string,
  title: string,
  data: readonly Worktree[],
  decoration: { icon?: 'pin'; repo?: SectionRepo } = {}
): Section {
  return {
    key,
    title,
    ...(decoration.icon ? { icon: decoration.icon } : {}),
    ...(decoration.repo ? { repo: decoration.repo } : {}),
    data: [...data]
  }
}

// Why: the previous 10-minute lastOutputAt window was too strict — most
// worktrees with idle terminal prompts had no recent output and were excluded.
// Any worktree with live terminals or unread output counts as "active".
export function isWorktreeActive(w: Worktree): boolean {
  if (w.hasHostSidebarActivity !== undefined) {
    return w.hasHostSidebarActivity
  }
  if (w.unread) {
    return true
  }
  if (w.status) {
    return w.status !== 'inactive'
  }
  if (w.liveTerminalCount > 0) {
    return true
  }
  return false
}

function isDefaultBranchWorkspace(w: Worktree): boolean {
  if (w.workspaceKind === 'folder-workspace') {
    return false
  }
  if (w.isMainWorktree !== undefined) {
    return w.isMainWorktree && w.branch.trim() !== ''
  }
  // Why: older hosts did not include isMainWorktree in worktree.ps, so keep the
  // legacy fallback until all paired runtimes carry the desktop predicate input.
  const branch = w.branch.replace(/^refs\/heads\//, '')
  return branch === 'main' || branch === 'master'
}

/**
 * Whether "Hide sleeping" must keep this row — the project's entry point (#8873).
 * Falls back to the branch heuristic for hosts that predate isMainWorktree; a
 * folder workspace is always its project's entry point, and isDefaultBranchWorkspace
 * rejects it by design, so it needs its own legacy arm or #8873 still reproduces.
 */
function isSleepingSweepExempt(w: Worktree, alwaysShowDefaultBranch: boolean | undefined): boolean {
  if (alwaysShowDefaultBranch === false) {
    return false
  }
  return w.isMainWorktree ?? (w.workspaceKind === 'folder-workspace' || isDefaultBranchWorkspace(w))
}

function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

export function filterWorktrees(
  worktrees: Worktree[],
  filters: FilterState,
  search: string
): Worktree[] {
  let result = worktrees.filter((w) => !w.isArchived && w.desktopOtherClient !== true)
  if (filters.hideSleeping) {
    result = result.filter(
      (w) => isSleepingSweepExempt(w, filters.alwaysShowDefaultBranch) || isWorktreeActive(w)
    )
  }
  if (filters.hideDefaultBranch) {
    result = result.filter((w) => !isDefaultBranchWorkspace(w))
  }
  if (filters.filterRepoIds.size > 0) {
    result = result.filter((w) => filters.filterRepoIds.has(w.repoId))
  }
  if (search.trim()) {
    const q = search.toLowerCase()
    result = result.filter(
      (w) =>
        w.displayName.toLowerCase().includes(q) ||
        w.branch.toLowerCase().includes(q) ||
        w.repo.toLowerCase().includes(q)
    )
  }
  return result
}

export function isWorktreePinned(w: Worktree, localPins: Set<string>): boolean {
  return w.isPinned || localPins.has(w.worktreeId)
}

export function buildMobileWorkspacePlan(
  worktrees: Worktree[],
  sortMode: MobileSortMode,
  filters: FilterState,
  search: string,
  groupMode: MobileGroupMode,
  pinnedIds: Set<string>,
  projectCatalog: ProjectSectionCatalog = NO_PROJECT_SECTION_CATALOG,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = DEFAULT_MOBILE_WORKSPACE_STATUSES,
  _collapsedGroups: ReadonlySet<string> = new Set(),
  showPinnedInGroups = false
) {
  const filtered = filterWorktrees(worktrees, filters, search)
  const sorted = sortWorktrees(filtered, sortMode)

  const childrenByParentIdentity = getMobileWorkspaceLineageChildren(
    filters.filterRepoIds.size > 0
      ? worktrees.filter((w) => filters.filterRepoIds.has(w.repoId))
      : worktrees
  )
  const repoMap = buildSectionRepoMap(projectCatalog.repos, worktrees)
  const projectIndex = buildProjectGroupingIndex(projectCatalog.grouping ?? undefined)
  const occurrencePlan = buildWorktreeOccurrencePlan({
    rows: sorted,
    childrenByParentIdentity,
    identityOf: getWorktreeRowIdentity,
    isPinned: (worktree) => isWorktreePinned(worktree, pinnedIds),
    duplicatePinned: showPinnedInGroups,
    owningSectionOf: (worktree) => getProjectGroupingForRepo(worktree.repoId, repoMap, projectIndex),
    sectionsOf: ({ pinned, natural: canonicalGroupWorktrees, displayRootByIdentity }) => {
      const sections: Section[] = []
      if (pinned.length > 0) {
        sections.push(makeSection('pinned', 'Pinned', pinned, { icon: 'pin' }))
      }

      if (groupMode === 'none') {
        if (canonicalGroupWorktrees.length > 0) {
          sections.push(makeSection('all', 'All', canonicalGroupWorktrees))
        }
      } else if (groupMode === 'repo') {
        const representedRepoIds = new Set(worktrees.map((w) => w.repoId))
        const query = search.trim().toLowerCase()
        const placeholderRepoIds = projectCatalog.repos
          .filter(
            (repo) =>
              !representedRepoIds.has(repo.id) &&
              (filters.filterRepoIds.size === 0 || filters.filterRepoIds.has(repo.id)) &&
              (!query || repo.displayName.toLowerCase().includes(query))
          )
          .map((repo) => repo.id)
        // Why: the desktop sidebar's own grouping, so keys, labels and order match it.
        const projectSections = withRepoSectionDisplayLabels(
          buildProjectSections({
            items: canonicalGroupWorktrees,
            repoIdOf: (w) => w.repoId,
            displayRepoIdOf: (w) => (displayRootByIdentity.get(getWorktreeRowIdentity(w)) ?? w).repoId,
            repoMap,
            projectIndex,
            placeholderRepoIds,
            repoOrder: projectCatalog.repoOrder,
            projectOrderBy: projectCatalog.projectOrderBy
          })
        )
        for (const [key, section] of projectSections) {
          sections.push(
            makeSection(key, section.label, orderMainWorktreeFirst(section.items), { repo: section.repo })
          )
        }
      } else if (groupMode === 'workspaceStatus') {
        const renderableWorkspaceStatuses = coerceMobileWorkspaceStatuses(workspaceStatuses)
        const byStatus = new Map<string, Worktree[]>()
        for (const w of canonicalGroupWorktrees) {
          const key = getMobileWorkspaceStatus(w, renderableWorkspaceStatuses)
          const list = byStatus.get(key)
          if (list) {
            list.push(w)
          } else {
            byStatus.set(key, [w])
          }
        }
        for (const status of renderableWorkspaceStatuses) {
          const items = byStatus.get(status.id)
          if (items && items.length > 0) {
            sections.push(
              makeSection(getMobileWorkspaceStatusGroupKey(status.id), status.label, items)
            )
          }
        }
      } else if (groupMode === 'prStatus') {
        const byGroup = new Map<string, Worktree[]>()
        for (const w of canonicalGroupWorktrees) {
          const key = getPRGroupKey(w)
          const list = byGroup.get(key)
          if (list) {
            list.push(w)
          } else {
            byGroup.set(key, [w])
          }
        }
        for (const groupKey of PR_GROUP_ORDER) {
          const items = byGroup.get(groupKey)
          if (items && items.length > 0) {
            sections.push(makeSection(`pr:${groupKey}`, PR_GROUP_LABELS[groupKey], items))
          }
        }
      }

      return sections.map((section): Section & WorktreeOccurrenceSection<Worktree> => ({
        ...section,
        items: section.data,
        placement: section.key === 'pinned' ? 'pinned' : 'natural'
      }))
    }
  })
  return {
    occurrencePlan,
    render: (collapsed: ReadonlySet<string>): Section[] =>
      occurrencePlan.sections.map((section) => ({
        key: section.key,
        title: section.title,
        ...(section.icon ? { icon: section.icon } : {}),
        ...(section.repo ? { repo: section.repo } : {}),
        data: getMobileOccurrenceRows(occurrencePlan, section.key, collapsed)
      }))
  }
}

export function buildSections(...args: Parameters<typeof buildMobileWorkspacePlan>): Section[] {
  return buildMobileWorkspacePlan(...args).render(args[8] ?? new Set())
}
