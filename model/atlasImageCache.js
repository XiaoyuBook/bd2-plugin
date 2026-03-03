import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRoleIndex } from './gamekeeRoleService.js'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT_DIR, 'data', 'atlas-icons')
const INDEX_FILE = path.join(CACHE_DIR, 'index.json')
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

let cacheIndex = null

function ensureAbsoluteUrl(url = '') {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `https://www.gamekee.com${url}`
  return url
}

function extFromUrl(url = '') {
  const pathname = url.split('?')[0].toLowerCase()
  if (pathname.endsWith('.png')) return 'png'
  if (pathname.endsWith('.webp')) return 'webp'
  if (pathname.endsWith('.gif')) return 'gif'
  return 'jpg'
}

function mimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp'
  return 'image/jpeg'
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

async function loadCacheIndex() {
  if (cacheIndex) return cacheIndex

  try {
    const text = await fs.readFile(INDEX_FILE, 'utf8')
    const parsed = JSON.parse(text)
    cacheIndex = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cacheIndex = {}
  }

  return cacheIndex
}

async function saveCacheIndex() {
  if (!cacheIndex) return
  await ensureCacheDir()
  await fs.writeFile(INDEX_FILE, JSON.stringify(cacheIndex, null, 2), 'utf8')
}

async function getCachedBufferByUrl(url) {
  const normalizedUrl = ensureAbsoluteUrl(url)
  if (!normalizedUrl) return null

  const index = await loadCacheIndex()
  const filename = index[normalizedUrl]
  if (!filename) return null

  const file = path.join(CACHE_DIR, filename)
  try {
    return await fs.readFile(file)
  } catch {
    return null
  }
}

async function fetchImageBuffer(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      referer: 'https://www.gamekee.com/',
      'user-agent': 'bd2-plugin/0.1 (+https://github.com/XiaoyuBook/bd2-plugin)'
    }
  })

  if (!response.ok) {
    throw new Error(`image request failed: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('empty image response')
  }

  if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
    throw new Error(`image too large: ${arrayBuffer.byteLength}`)
  }

  return Buffer.from(arrayBuffer)
}

export async function cacheImageByUrl(url, force = false) {
  const normalizedUrl = ensureAbsoluteUrl(url)
  if (!normalizedUrl) {
    return { status: 'skip', reason: 'empty_url' }
  }

  await ensureCacheDir()
  const index = await loadCacheIndex()

  if (!force) {
    const existingBuffer = await getCachedBufferByUrl(normalizedUrl)
    if (existingBuffer) {
      return { status: 'skip', reason: 'cached' }
    }
  }

  const ext = extFromUrl(normalizedUrl)
  const digest = createHash('sha1').update(normalizedUrl).digest('hex')
  const filename = `${digest}.${ext}`
  const targetFile = path.join(CACHE_DIR, filename)

  const buffer = await fetchImageBuffer(normalizedUrl)
  await fs.writeFile(targetFile, buffer)
  index[normalizedUrl] = filename
  await saveCacheIndex()

  return { status: 'ok', filename }
}

function collectRoleImageUrls(roles = []) {
  const urls = new Set()
  for (const role of roles) {
    if (role?.icon) urls.add(ensureAbsoluteUrl(role.icon))
    for (const skin of role?.skins || []) {
      if (skin?.icon) urls.add(ensureAbsoluteUrl(skin.icon))
    }
  }
  return [...urls].filter(Boolean)
}

export async function updateAtlasImageCache(force = false) {
  const { roles } = await getRoleIndex(true)
  const urls = collectRoleImageUrls(roles)

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const url of urls) {
    try {
      const result = await cacheImageByUrl(url, force)
      if (result.status === 'ok') {
        downloaded += 1
      } else {
        skipped += 1
      }
    } catch {
      failed += 1
    }
  }

  return {
    total: urls.length,
    downloaded,
    skipped,
    failed,
    cacheDir: CACHE_DIR
  }
}

export async function toRenderableImageSrc(url) {
  const normalizedUrl = ensureAbsoluteUrl(url)
  if (!normalizedUrl) return ''

  let buffer = await getCachedBufferByUrl(normalizedUrl)

  if (!buffer) {
    try {
      await cacheImageByUrl(normalizedUrl, false)
      buffer = await getCachedBufferByUrl(normalizedUrl)
    } catch {
      return normalizedUrl
    }
  }

  if (!buffer) return normalizedUrl
  const mime = mimeFromBuffer(buffer)
  const base64 = buffer.toString('base64')
  return `data:${mime};base64,${base64}`
}
