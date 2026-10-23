export const AMAZON_SEARCH_ENDPOINT = 'https://creatorsapi.amazon/catalog/v1/searchItems'
export const AMAZON_ASSOCIATE_TAG = 'koudenpa0a-22'
const tokenEndpoint = 'https://api.amazon.co.jp/auth/o2/token'
const marketplace = 'www.amazon.co.jp'
const imageHosts = new Set([
  'm.media-amazon.com',
  'images-fe.ssl-images-amazon.com',
  'images-jp.ssl-images-amazon.com',
  'images-na.ssl-images-amazon.com',
])

export interface AmazonEnv {
  AMAZON_CLIENT_ID?: string
  AMAZON_CLIENT_SECRET?: string
}

export interface AmazonProduct {
  asin: string
  name: string | null
  thumbnail: string | null
}

let cachedToken: { clientId: string; value: string; expiresAt: number } | null = null

async function readJson(response: Response, max: number): Promise<unknown> {
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel()
    throw new Error('Unexpected Amazon response type.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Amazon response was empty.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel()
        throw new Error('Amazon response was too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function amazonAffiliateEnabled(): boolean {
  return true
}

export function amazonApiEnabled(env: AmazonEnv): boolean {
  return !!env.AMAZON_CLIENT_ID && !!env.AMAZON_CLIENT_SECRET
}

export function amazonSearchLinks(barcode: string) {
  const searchUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(barcode)}`
  return {
    affiliateUrl: `${searchUrl}&tag=${AMAZON_ASSOCIATE_TAG}`,
    standardUrl: searchUrl,
  }
}

export function createAmazonSearchRequest(accessToken: string, barcode: string, partnerTag: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', accessToken].join(' '),
      'Content-Type': 'application/json',
      'x-marketplace': marketplace,
    },
    body: JSON.stringify({
      keywords: barcode,
      marketplace,
      partnerTag,
      resources: ['images.primary.small', 'itemInfo.title', 'itemInfo.externalIds'],
    }),
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nested(source: unknown, ...keys: string[]): unknown {
  let value = source
  for (const key of keys) value = object(value)[key]
  return value
}

function displayValues(value: unknown): unknown[] {
  const record = object(value)
  const values = record.displayValues ?? record.DisplayValues
  return Array.isArray(values) ? values : []
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.port &&
      !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function amazonProductFromResponse(value: unknown, barcode: string): AmazonProduct | null {
  const root = object(value)
  const result = object(root.itemsResult ?? root.searchResult ?? root.SearchResult)
  const items = result.items ?? result.Items ?? root.items
  if (!Array.isArray(items)) return null
  for (const entry of items) {
    const item = object(entry)
    const info = item.itemInfo ?? item.ItemInfo
    const externalIds = object(nested(info, 'externalIds') ?? nested(info, 'ExternalIds'))
    const eans = externalIds.eans ?? externalIds.EANs
    const upcs = externalIds.upcs ?? externalIds.UPCs
    const identifiers = [...displayValues(eans), ...displayValues(upcs)]
    const asin = item.asin ?? item.ASIN
    if (!identifiers.includes(barcode) || typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin)) continue

    const title = nested(info, 'title') ?? nested(info, 'Title')
    const image = nested(item.images ?? item.Images, 'primary', 'small') ??
      nested(item.images ?? item.Images, 'Primary', 'Small')
    const titleValue = object(title).displayValue ?? object(title).DisplayValue
    const imageValue = object(image).url ?? object(image).URL
    return {
      asin,
      name: typeof titleValue === 'string'
        ? titleValue.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || null
        : null,
      thumbnail: imageUrl(imageValue),
    }
  }
  return null
}

async function accessToken(env: AmazonEnv): Promise<string> {
  if (!amazonApiEnabled(env)) throw new Error('Amazon Creators API is not configured.')
  const currentToken = cachedToken
  if (currentToken && currentToken.clientId === env.AMAZON_CLIENT_ID && currentToken.expiresAt > Date.now()) {
    return currentToken.value
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.AMAZON_CLIENT_ID!,
        client_secret: env.AMAZON_CLIENT_SECRET!,
        scope: 'creatorsapi::default',
      }),
    })
    const data = object(await readJson(response, 16 * 1024))
    if (!response.ok || typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) {
      throw new Error('Amazon authentication failed.')
    }
    cachedToken = {
      clientId: env.AMAZON_CLIENT_ID!,
      value: data.access_token,
      expiresAt: Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000,
    }
    return data.access_token
  } finally {
    clearTimeout(timer)
  }
}

export async function searchAmazonProduct(env: AmazonEnv, barcode: string): Promise<AmazonProduct | null> {
  const token = await accessToken(env)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(AMAZON_SEARCH_ENDPOINT, {
      ...createAmazonSearchRequest(token, barcode, AMAZON_ASSOCIATE_TAG),
      redirect: 'error',
      signal: controller.signal,
    })
    const data = await readJson(response, 128 * 1024)
    if (!response.ok) return null
    return amazonProductFromResponse(data, barcode)
  } finally {
    clearTimeout(timer)
  }
}
