import assert from 'node:assert/strict'
import test from 'node:test'
import { createRepository } from './persistence.js'

test('uses an offline repository unless MySQL persistence is enabled', async () => {
  const previous = process.env.DB_ENABLED
  delete process.env.DB_ENABLED
  const repository = createRepository()
  assert.equal(repository.enabled, false)
  await repository.initialize()
  assert.deepEqual(await repository.loadDevices(), [])
  await repository.close()
  if (previous === undefined) delete process.env.DB_ENABLED
  else process.env.DB_ENABLED = previous
})
