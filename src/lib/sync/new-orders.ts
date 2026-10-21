// New-order detection for sync alerts. Each order pull re-reads a 7-day
// window, so "new" means fetched refs that were not stored before the pull.

export function countNewOrders(fetchedRefs: string[], existingRefs: string[]): number {
  const existing = new Set(existingRefs)
  return new Set(fetchedRefs.filter((ref) => !existing.has(ref))).size
}
