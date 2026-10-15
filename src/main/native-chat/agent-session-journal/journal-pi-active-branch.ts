import type { AgentJournalItemIdentity } from '../../../shared/agent-session-journal-types'
import type { NativeChatMessage } from '../../../shared/native-chat-types'
import { asRecord, parseJsonObject, timestampMs } from '../../ai-vault/session-scanner-values'
import { decodeOmpTranscriptLine } from '../transcript-line-decoders-omp'

type PiTranscriptBranchEntry<T> = {
  id: string
  parentId: string | null
  type: unknown
  firstKeptEntryId: string | null
  item: T | null
}

/** `toItem` runs as each line is read, so an entry holds only what the caller keeps of it. */
export function createPiTranscriptCollector<T>(
  toItem: (message: NativeChatMessage, identity: AgentJournalItemIdentity) => T
): {
  record(line: string, fallbackId: string, identity: AgentJournalItemIdentity): void
  project(): T[]
} {
  const entries: PiTranscriptBranchEntry<T>[] = []
  const fileEntryIds: (string | null)[] = []
  let version = 1
  return {
    record(line, fallbackId, identity) {
      const record = parseJsonObject(line)
      if (!record) {
        return
      }
      if (record.type === 'session') {
        version = typeof record.version === 'number' ? record.version : 1
        fileEntryIds.push(null)
        return
      }
      const id = version < 2 ? `#${fileEntryIds.length}` : record.id
      const parentId = version < 2 ? (entries.at(-1)?.id ?? null) : record.parentId
      if (typeof id !== 'string' || !(parentId === null || typeof parentId === 'string')) {
        throw new Error('Pi session entry has no valid branch identity')
      }
      // Pi v1 indexes include the header and parsed metadata, but not malformed lines.
      const firstKeptEntryId =
        version < 2 && typeof record.firstKeptEntryIndex === 'number'
          ? fileEntryIds[record.firstKeptEntryIndex]
          : record.firstKeptEntryId
      const message =
        record.type === 'compaction' || record.type === 'branch_summary'
          ? piSummaryMessage(record, fallbackId)
          : asRecord(record.message)?.role === 'system'
            ? null
            : decodeOmpTranscriptLine(line, fallbackId)
      entries.push({
        id,
        parentId,
        type: record.type,
        firstKeptEntryId: typeof firstKeptEntryId === 'string' ? firstKeptEntryId : null,
        item: message ? toItem(message, identity) : null
      })
      fileEntryIds.push(id)
    },
    project: () => selectActivePiBranch(entries)
  }
}

function piSummaryMessage(
  record: Record<string, unknown>,
  fallbackId: string
): NativeChatMessage | null {
  const summary = typeof record.summary === 'string' ? record.summary : ''
  if (record.type === 'branch_summary' && !summary) {
    return null
  }
  const timestamp = timestampMs(record.timestamp)
  return {
    id: typeof record.id === 'string' ? record.id : fallbackId,
    role: 'system',
    blocks: [{ type: 'text', text: summary }],
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    source: 'transcript'
  }
}

/** Match Pi's fresh-session TUI: persisted leaf ancestry, then buildContextEntries. */
function selectActivePiBranch<T>(entries: readonly PiTranscriptBranchEntry<T>[]): T[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) {
    throw new Error('Pi session has duplicate branch identities')
  }
  const branch: PiTranscriptBranchEntry<T>[] = []
  const visited = new Set<string>()
  let current = entries.at(-1)
  while (current) {
    if (visited.has(current.id)) {
      throw new Error('Pi session branch contains a cycle')
    }
    visited.add(current.id)
    branch.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return compactedPiBranch(branch.toReversed()).flatMap((entry) => (entry.item === null ? [] : [entry.item]))
}

function compactedPiBranch<T>(branch: PiTranscriptBranchEntry<T>[]): PiTranscriptBranchEntry<T>[] {
  const compactionIndex = branch.findLastIndex((entry) => entry.type === 'compaction')
  const compaction = branch[compactionIndex]
  if (!compaction) {
    return branch
  }
  const keptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
  // Pi searches for firstKeptEntryId only before the latest compaction.
  const kept =
    keptIndex !== -1 && keptIndex < compactionIndex ? branch.slice(keptIndex, compactionIndex) : []
  return [compaction, ...kept, ...branch.slice(compactionIndex + 1)]
}
