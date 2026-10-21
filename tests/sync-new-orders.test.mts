import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countNewOrders } from '../src/lib/sync/new-orders.ts'

test('countNewOrders: counts fetched refs not already stored', () => {
  assert.equal(countNewOrders(['a', 'b', 'c'], ['b']), 2)
})

test('countNewOrders: ignores duplicates in the fetched batch', () => {
  assert.equal(countNewOrders(['a', 'a', 'b'], []), 2)
})

test('countNewOrders: zero when everything is known or nothing fetched', () => {
  assert.equal(countNewOrders(['a'], ['a', 'z']), 0)
  assert.equal(countNewOrders([], ['a']), 0)
})
