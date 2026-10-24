import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTargetSyntax, isConfiguredAddressAllowed } from './target-policy.js'

test('rejects malformed monitoring target syntax', () => {
  assert.throws(() => assertTargetSyntax('not a target'), /valid IPv4 address or hostname/)
  assert.throws(() => assertTargetSyntax(''), /valid IPv4 address or hostname/)
})

test('blocks restricted addresses before probing', () => {
  const previousLoopback = process.env.ALLOW_LOOPBACK_TARGETS
  delete process.env.ALLOW_LOOPBACK_TARGETS
  try {
    assert.equal(isConfiguredAddressAllowed('127.0.0.1'), false)
    assert.equal(isConfiguredAddressAllowed('169.254.169.254'), false)
    assert.equal(isConfiguredAddressAllowed('224.0.0.1'), false)
    assert.equal(isConfiguredAddressAllowed('192.168.1.20'), true)
  } finally {
    if (previousLoopback === undefined) delete process.env.ALLOW_LOOPBACK_TARGETS
    else process.env.ALLOW_LOOPBACK_TARGETS = previousLoopback
  }
})
