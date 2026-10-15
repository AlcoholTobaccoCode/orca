// The installed releases of a runtime Orca downloads for an agent: `<root>/<version>/` holding the
// pinned members and a receipt written before the folder was renamed into place. Read-only, and
// cheap enough for every launch: a full hash is only ever taken by an install.

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export type ManagedRuntimePin = {
  version: string
  url: string
  archiveSha256: string
  /** The decoded archive's size. */
  archiveBytes: number
  /** Archive-relative path, sha256 and size of every executable the release must hold. */
  members: readonly { path: string; sha256: string; bytes: number }[]
}

/** A runtime Orca installs only when the person asks; a launch reads what is installed. */
export type ManagedRuntime = {
  /** Shown to the person, e.g. "Antigravity". */
  label: string
  /** The folder that holds only this runtime's releases. */
  root(dataDirectory: string): string
  /** This host's pinned release; null where none is published. */
  pin(): ManagedRuntimePin | null
}

export const RUNTIME_RELEASE_RECEIPT = '.install-complete.json'
const RECEIPT_MAX_BYTES = 8 * 1024
const VERSION_ORDER = new Intl.Collator(undefined, { numeric: true })

const runtimeReleaseReceiptSchema = z.object({
  releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.string().min(1),
  platform: z.string(),
  arch: z.string(),
  members: z
    .array(z.object({ path: z.string().min(1), bytes: z.number().int().positive() }))
    .min(1)
})

export type InstalledRuntimeRelease = {
  folder: string
  version: string
  /** The pinned release itself, rather than an older one kept runnable. */
  current: boolean
}

/** The release a launch runs: the pinned one when installed whole, else the newest other complete
 *  one; null when none is. Staging, links and anything incomplete never count. */
export function resolveInstalledRuntimeRelease(
  root: string,
  pin: ManagedRuntimePin | null
): InstalledRuntimeRelease | null {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return null
  }
  const releases = names
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => {
      const releaseId = completeReleaseId(join(root, name), name)
      return releaseId ? [{ name, releaseId }] : []
    })
  const pinned = releases.find(
    (release) => release.name === pin?.version && release.releaseId === pin.archiveSha256
  )
  const chosen =
    pinned ??
    releases.sort((a, b) => VERSION_ORDER.compare(b.name, a.name))[0]
  return chosen
    ? { folder: join(root, chosen.name), version: chosen.name, current: chosen === pinned }
    : null
}

/** The receipt's release id when `folder` is a whole release for this host, else null. */
function completeReleaseId(folder: string, version: string): string | null {
  try {
    const receiptPath = join(folder, RUNTIME_RELEASE_RECEIPT)
    const stat = lstatSync(receiptPath)
    if (!lstatSync(folder).isDirectory() || !stat.isFile() || stat.size > RECEIPT_MAX_BYTES) {
      return null
    }
    const receipt = runtimeReleaseReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, 'utf8')))
    const whole =
      receipt.version === version &&
      receipt.platform === process.platform &&
      receipt.arch === process.arch &&
      receipt.members.every((member) => {
        const segments = member.path.split('/')
        if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
          return false
        }
        const file = lstatSync(join(folder, ...segments))
        return (
          file.isFile() &&
          file.size === member.bytes &&
          (process.platform === 'win32' || (file.mode & 0o111) !== 0)
        )
      })
    return whole ? receipt.releaseId : null
  } catch {
    return null
  }
}
