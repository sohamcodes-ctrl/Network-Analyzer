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

test('parses a successful Linux ping summary', () => {
  const output = `
PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.035 ms
64 bytes from 127.0.0.1: icmp_seq=2 ttl=64 time=0.053 ms
64 bytes from 127.0.0.1: icmp_seq=3 ttl=64 time=0.024 ms
64 bytes from 127.0.0.1: icmp_seq=4 ttl=64 time=0.080 ms

--- 127.0.0.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3095ms
rtt min/avg/max/mdev = 0.024/0.048/0.080/0.021 ms
  `
  const result = parsePingOutput(output)
  assert.deepEqual(result, { received: 4, loss: 0, average: 0.048 })
})

