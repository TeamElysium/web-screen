export const CLIENT_IP_HEADER = 'x-web-screen-client-ip'

const LOCALHOST_ALIASES = ['127.0.0.1', '::1']

type HeaderMap = Headers | Record<string, string | string[] | undefined>

function firstHeaderValue(headers: HeaderMap, name: string): string {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || ''
  }

  const value = (headers as Record<string, string | string[] | undefined>)[name]
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

export function normalizeIP(ip: string | null | undefined): string {
  let value = (ip || '').trim()
  if (!value) return ''

  value = value.split(',')[0].trim()

  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    if (closingBracket > 0) {
      value = value.slice(1, closingBracket)
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'))
  }

  if (value.startsWith('::ffff:')) {
    value = value.slice('::ffff:'.length)
  }

  return value
}

export function getClientIPFromHeaders(headers: HeaderMap): string {
  const directIP = firstHeaderValue(headers, CLIENT_IP_HEADER)
  if (directIP) return normalizeIP(directIP)

  if (process.env.TRUST_PROXY === 'true') {
    return getClientIPFromProxyHeaders(headers)
  }

  return ''
}

export function getClientIPFromProxyHeaders(headers: HeaderMap): string {
  return normalizeIP(
    firstHeaderValue(headers, 'x-real-ip') ||
    firstHeaderValue(headers, 'x-forwarded-for')
  )
}

export function getClientIPForServer(
  headers: HeaderMap,
  remoteAddress: string | null | undefined,
): string {
  if (process.env.TRUST_PROXY === 'true') {
    const proxyIP = getClientIPFromProxyHeaders(headers)
    if (proxyIP) return proxyIP
  }

  return normalizeIP(remoteAddress)
}

export function checkIP(ip: string | null | undefined): boolean {
  const allowed = process.env.ALLOWED_IPS || ''
  const allowedList = allowed
    .split(',')
    .map(normalizeIP)
    .filter(Boolean)

  if (allowedList.length === 0) return false

  const clientIP = normalizeIP(ip)
  if (!clientIP) return false

  if (
    LOCALHOST_ALIASES.includes(clientIP) &&
    allowedList.some((allowedIP) => LOCALHOST_ALIASES.includes(allowedIP))
  ) {
    return true
  }

  return allowedList.includes(clientIP)
}
