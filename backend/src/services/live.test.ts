import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePingOutput } from './live.js'

test('parses a successful Windows ping summary', () => {
  const result = parsePingOutput(`
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
    Approximate round trip times in milli-seconds:
        Minimum = 10ms, Maximum = 14ms, Average = 12ms
  `)
  assert.deepEqual(result, { received: 4, loss: 0, average: 12 })
})

test('parses packet loss when no response samples are present', () => {
  const result = parsePingOutput('Packets: Sent = 4, Received = 1, Lost = 3 (75% loss),')
  assert.deepEqual(result, { received: 1, loss: 75, average: 0 })
})
