import dns from 'node:dns/promises'
import net from 'node:net'

const ipv4ToNumber = (address: string) => address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0)

const configuredCidrs = () => (process.env.MONITORING_ALLOWED_CIDRS || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
  .split(',').map(value => value.trim()).filter(Boolean)

const configuredHostnames = () => new Set((process.env.MONITORING_ALLOWED_HOSTNAMES || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean))

const matchesCidr = (address: string, cidr: string) => {
  const [network, prefixText] = cidr.split('/')
  const prefix = Number(prefixText)
  if (net.isIPv4(address) !== true || !net.isIPv4(network) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask)
}

const isForbiddenAddress = (address: string) => {
  if (!net.isIPv4(address)) return true
  const value = ipv4ToNumber(address)
  const loopback = (value >>> 24) === 127
  const linkLocal = (value >>> 24) === 169 && ((value >>> 16) & 255) === 254
  const multicast = (value >>> 28) === 14
  const broadcast = value === 0xffffffff
  const metadata = value === ipv4ToNumber('169.254.169.254')
  if (metadata || linkLocal || multicast || broadcast) return true
  if (loopback && process.env.ALLOW_LOOPBACK_TARGETS !== 'true') return true
  return false
}

const isAllowedAddress = (address: string) => {
  if (isForbiddenAddress(address)) return false
  if (process.env.ALLOW_PUBLIC_TARGETS === 'true') return true
  return configuredCidrs().some(cidr => matchesCidr(address, cidr))
}

export const isConfiguredAddressAllowed = (address: string) => isAllowedAddress(address)

export const assertTargetSyntax = (address: string) => {
  const normalized = address.trim().toLowerCase()
  if (!normalized || normalized.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(normalized)) {
    throw Object.assign(new Error('Enter a valid IPv4 address or hostname.'), { status: 400 })
  }
  return normalized
}

export const validateTarget = async (address: string) => {
  const normalized = assertTargetSyntax(address)
  const addresses = net.isIPv4(normalized) ? [normalized] : (await dns.lookup(normalized, { all: true })).map(result => result.address)
  if (!addresses.length || addresses.some(resolved => !isAllowedAddress(resolved))) {
    throw Object.assign(new Error('Monitoring target is outside the configured target policy.'), { status: 400 })
  }
  if (!net.isIPv4(normalized) && !configuredHostnames().has(normalized) && process.env.ALLOW_PUBLIC_TARGETS !== 'true') {
    throw Object.assign(new Error('Hostname is not included in MONITORING_ALLOWED_HOSTNAMES.'), { status: 400 })
  }
  return addresses
}

export const isConfiguredHostname = (address: string) => configuredHostnames().has(address.trim().toLowerCase())
