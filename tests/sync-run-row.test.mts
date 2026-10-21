import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSyncRunRow } from '../src/lib/sync/run-row.ts'
import {
  LISTING_SNAPSHOT_RETENTION_DAYS,
  SYNC_RUN_RETENTION_DAYS,
  listingSnapshotRetentionCutoff,
  syncRunRetentionCutoff,
} from '../src/lib/sync/retention.ts'

const base = {
  marketAccountId: 'acc-1',
  syncType: 'orders',
  direction: 'pull' as const,
  startedAt: '2026-09-14T00:00:00.000Z',
}

test('buildSyncRunRow: success without failures is completed', () => {
  const row = buildSyncRunRow(
    { ...base, outcome: { success: true, processed: 9, failed: 0, error: null } },
    '2026-09-14T00:00:03.000Z',
  )
  assert.equal(row.status, 'completed')
  assert.equal(row.items_processed, 9)
  assert.equal(row.items_failed, 0)
  assert.equal(row.error_message, null)
  assert.equal(row.started_at, base.startedAt)
  assert.equal(row.completed_at, '2026-09-14T00:00:03.000Z')
})

test('buildSyncRunRow: success with some failures is partial', () => {
  const row = buildSyncRunRow({ ...base, outcome: { success: true, processed: 8, failed: 1, error: null } })
  assert.equal(row.status, 'partial')
})

test('buildSyncRunRow: unsuccessful outcome is failed and keeps the message', () => {
  const row = buildSyncRunRow({
    ...base,
    outcome: { success: false, processed: 0, failed: 0, error: 'API request failed: 500' },
  })
  assert.equal(row.status, 'failed')
  assert.equal(row.error_message, 'API request failed: 500')
})

test('buildSyncRunRow: manual runs leave schedule_id null', () => {
  const row = buildSyncRunRow({ ...base, outcome: { success: true, processed: 0, failed: 0, error: null } })
  assert.equal(row.schedule_id, null)
})

test('buildSyncRunRow: scheduled runs carry the schedule id', () => {
  const row = buildSyncRunRow({
    ...base,
    scheduleId: 'sched-1',
    outcome: { success: true, processed: 0, failed: 0, error: null },
  })
  assert.equal(row.schedule_id, 'sched-1')
})

test('syncRunRetentionCutoff: defaults to 90 days before now', () => {
  assert.equal(SYNC_RUN_RETENTION_DAYS, 90)
  const now = new Date('2026-09-14T12:00:00.000Z')
  assert.equal(syncRunRetentionCutoff(now), '2026-06-16T12:00:00.000Z')
})

test('syncRunRetentionCutoff: honours an explicit window', () => {
  const now = new Date('2026-09-14T12:00:00.000Z')
  assert.equal(syncRunRetentionCutoff(now, 1), '2026-09-13T12:00:00.000Z')
})

test('syncRunRetentionCutoff: rejects a non-positive window', () => {
  assert.throws(() => syncRunRetentionCutoff(new Date(), 0))
  assert.throws(() => syncRunRetentionCutoff(new Date(), Number.NaN))
})

test('listingSnapshotRetentionCutoff: defaults to 30 days before now', () => {
  assert.equal(LISTING_SNAPSHOT_RETENTION_DAYS, 30)
  const now = new Date('2026-10-21T00:00:00.000Z')
  assert.equal(listingSnapshotRetentionCutoff(now), '2026-09-21T00:00:00.000Z')
})
