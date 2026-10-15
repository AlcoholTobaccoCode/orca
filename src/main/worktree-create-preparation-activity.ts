import type { PreparedCheckoutOrigin } from '../shared/worktree/create-types'
import { beginPreparationWork, type PreparationWork } from './worktree-create-concurrency'

/** A prepared checkout's build: who asked for it, its disk work, its timing, and whether it
 *  finished — the one fact that makes the checkout claimable. */
export type PreparationActivity = {
  /** Counts the build as disk work competing with creates. */
  readonly work: PreparationWork
  /** An explicit prefetch asked for this checkout too. */
  requestedByPrefetch(): void
  /** Covers the build until it settles. */
  track(build: Promise<void>): void
  /** The build succeeded; a create never waits for one that has not. */
  built(): boolean
  origin(): PreparedCheckoutOrigin
  /** Build duration, and how long the checkout then sat ready before `claimedAt`. */
  timesAt(claimedAt: number): { buildMs: number; idleMs: number }
}

export function createPreparationActivity(kind: 'explicit' | 'automatic'): PreparationActivity {
  const work = beginPreparationWork()
  // Includes any wait for the base fetch the build is gated on.
  const buildStartedAt = performance.now()
  let builtAt: number | undefined
  let prefetchRequested = false

  return {
    work,
    requestedByPrefetch() {
      prefetchRequested = true
    },
    track(build) {
      void build.then(
        () => {
          builtAt = performance.now()
          work.end()
        },
        () => work.end()
      )
    },
    built() {
      return builtAt !== undefined
    },
    origin() {
      if (kind === 'explicit') {
        return 'prefetch'
      }
      return prefetchRequested ? 'rearm_then_prefetch' : 'rearm'
    },
    timesAt(claimedAt) {
      const readyAt = builtAt ?? claimedAt
      return {
        buildMs: Math.max(0, readyAt - buildStartedAt),
        idleMs: Math.max(0, claimedAt - readyAt)
      }
    }
  }
}
