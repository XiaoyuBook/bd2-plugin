const ROLE_ATLAS_URL = 'https://www.gamekee.com/zsca2/jstj/122229?tab=jstj'
const HOME_URL = 'https://www.gamekee.com/zsca2/'
const PICKUP_URL = 'https://www.gamekee.com/zsca2/jstj/122229?tab=pickUp'
const STATE_PATH_RE = /ssr-vuex-store-state\.js\?cacheKey=[^"']+/
const ROLE_PAGE_COMPONENT = 'pageTjRole'
const REVIEW_PAGE_COMPONENT = 'PageDetailZSTJ'
const CACHE_TTL_MS = 30 * 60 * 1000
const UP_CACHE_TTL_MS = 10 * 60 * 1000

let roleCache = {
  expiresAt: 0,
  roles: [],
  updatedAt: 0
}

const reviewCache = new Map()
let currentUpCache = {
  expiresAt: 0,
  items: []
}
let pickupEndTimeCache = {
  expiresAt: 0,
  byContentId: new Map()
}

function normalizeText(text = '') {
  return String(text).trim().toLowerCase().replace(/\s+/g, '')
}

function cleanMarkupText(text = '') {
  return String(text)
    // Normalize variant: ***orange***文本*** -> ***orange 文本***
    .replace(/\*{3}([a-zA-Z]+)\*{3}([\s\S]*?)\*{3}/g, '***$1 $2***')
    // GameKee color marker like ***orange 文本*** / ***orange文本***
    .replace(/\*{3}[a-zA-Z]+(?:\s+)?([\s\S]*?)\*{3}/g, (_, inner) =>
      String(inner || '').replace(/^[：:]\s*/, '')
    )
    // Bold marker: **文本**
    .replace(/\*{2}([\s\S]*?)\*{2}/g, '$1')
    // Fallback: remove unmatched color prefix / trailing marker only.
    .replace(/\*{3}[a-zA-Z]+/g, ' ')
    .replace(/\*{3}/g, ' ')
    .replace(/\*{2}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ensureAbsoluteUrl(url = '') {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `https://www.gamekee.com${url}`
  return `https://www.gamekee.com/${url}`
}

function extractSkillSummary(skin) {
  const strengthen = skin?.skills?.strengthen
  if (!Array.isArray(strengthen) || strengthen.length === 0) return ''

  const level0 = strengthen.find((item) => item?.name === '+0') || strengthen[0]
  if (!level0?.desc) return ''

  return String(level0.desc).replace(/\s+/g, ' ').trim()
}

function mapRoleList(roleList = []) {
  return roleList.map((role) => {
    const roleName = String(role?.name || '').trim()
    const contentId = role?.content_id
    const roleUrl = contentId ? `https://www.gamekee.com/zsca2/${contentId}.html` : ROLE_ATLAS_URL
    const skins = Array.isArray(role?.skin)
      ? role.skin.map((skin) => ({
          id: skin?.id,
          name: String(skin?.name || '').trim(),
          roleName: String(skin?.role_name || roleName).trim(),
          isInitial: Boolean(skin?.is_initial),
          star: String(skin?.star || role?.star || '').trim(),
          attr: String(skin?.attr || role?.attr || '').trim(),
          birthday: String(skin?.birthday || role?.birthday || '').trim(),
          skillSummary: extractSkillSummary(skin),
          sp: String((skin?.skills?.strengthen?.find((item) => item?.name === '+0') || skin?.skills?.strengthen?.[0])?.sp || '').trim(),
          cd: String((skin?.skills?.strengthen?.find((item) => item?.name === '+0') || skin?.skills?.strengthen?.[0])?.cd || '').trim(),
          icon: ensureAbsoluteUrl(String(skin?.icon || '').trim())
        }))
      : []

    return {
      id: role?.id,
      name: roleName,
      normalizedName: normalizeText(roleName),
      star: String(role?.star || '').trim(),
      attr: String(role?.attr || '').trim(),
      damage: String(role?.damage || '').trim(),
      birthday: String(role?.birthday || '').trim(),
      icon: ensureAbsoluteUrl(String(role?.icon || '').trim()),
      contentId,
      roleUrl,
      skins
    }
  })
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': 'bd2-plugin/0.1 (+https://github.com/XiaoyuBook/bd2-plugin)'
    }
  })

  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function fetchRemoteRoles() {
  const atlasHtml = await fetchText(ROLE_ATLAS_URL)
  const statePathMatch = atlasHtml.match(STATE_PATH_RE)

  if (!statePathMatch) {
    throw new Error('failed to locate gamekee SSR state URL')
  }

  const stateUrl = ensureAbsoluteUrl(statePathMatch[0])
  const stateText = await fetchText(stateUrl)
  const stateJson = JSON.parse(stateText.replace(/^window\.__INITIAL_STATE__\s*=\s*/, ''))
  const roleComponent = (stateJson?.ssrComponentData || []).find(
    (item) => item?.componentName === ROLE_PAGE_COMPONENT
  )

  if (!roleComponent?.componentData) {
    throw new Error('failed to locate role component data')
  }

  const roleData = JSON.parse(roleComponent.componentData)
  const roleList = Array.isArray(roleData?.roleList) ? roleData.roleList : []

  return {
    roles: mapRoleList(roleList),
    updatedAt: Date.now()
  }
}

function getLocalizedText(value, locale = 'zh-cn') {
  if (typeof value === 'string') return cleanMarkupText(value)
  if (!value || typeof value !== 'object') return ''
  return cleanMarkupText(value[locale] || value['zh-hk'] || value.en || '')
}

function getLocalizedRawText(value, locale = 'zh-cn') {
  if (typeof value === 'string') return String(value).trim()
  if (!value || typeof value !== 'object') return ''
  return String(value[locale] || value['zh-hk'] || value.en || '').trim()
}

function stripHtmlTags(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractUpEndTime(text = '') {
  const normalized = stripHtmlTags(text)

  const rangeMatch =
    normalized.match(/(\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*[日]?\s*[-~至到]\s*\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*日?)/) ||
    normalized.match(/(\d{4}\s*[.-\/年]\s*\d{1,2}\s*[.-\/月]\s*\d{1,2}\s*日?)/)
  if (rangeMatch?.[1]) {
    return rangeMatch[1].replace(/\s+/g, '')
  }

  const endMatch =
    normalized.match(/(?:截止|截至|结束(?:于|时间)?|到期)\s*[:：]?\s*(\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*日?)/i) ||
    normalized.match(/(?:截止|截至|结束(?:于|时间)?|到期)\s*[:：]?\s*(\d{4}\s*[.-\/年]\s*\d{1,2}\s*[.-\/月]\s*\d{1,2}\s*日?)/i)
  if (endMatch?.[1]) {
    return endMatch[1].replace(/\s+/g, '')
  }

  return ''
}

function extractDateLike(text = '') {
  const normalized = stripHtmlTags(text)
  if (!normalized) return ''

  const range =
    normalized.match(/\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*[日]?\s*[-~至到]\s*\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*日?/) ||
    normalized.match(/\d{4}\s*[.-\/年]\s*\d{1,2}\s*[.-\/月]\s*\d{1,2}\s*日?\s*[-~至到]\s*\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*日?/)
  if (range?.[0]) return range[0].replace(/\s+/g, '')

  const single =
    normalized.match(/\d{4}\s*[.-\/年]\s*\d{1,2}\s*[.-\/月]\s*\d{1,2}\s*日?/) ||
    normalized.match(/\d{1,2}\s*[\/月.-]\s*\d{1,2}\s*日?/)
  if (single?.[0]) return single[0].replace(/\s+/g, '')

  return ''
}

function parseDateToTs(text = '') {
  const s = String(text || '').trim()
  if (!s) return 0

  const full = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (full) {
    const y = Number(full[1])
    const m = Number(full[2])
    const d = Number(full[3])
    const ts = new Date(y, m - 1, d).getTime()
    return Number.isNaN(ts) ? 0 : ts
  }

  const md = s.match(/(\d{1,2})\D+(\d{1,2})/)
  if (md) {
    const y = new Date().getFullYear()
    const m = Number(md[1])
    const d = Number(md[2])
    const ts = new Date(y, m - 1, d).getTime()
    return Number.isNaN(ts) ? 0 : ts
  }

  return 0
}

function pickBetterEndTime(prev = '', next = '') {
  if (!next) return prev
  if (!prev) return next

  const prevTs = parseDateToTs(prev)
  const nextTs = parseDateToTs(next)
  if (!prevTs || !nextTs) return nextTs ? next : prev

  const now = Date.now()
  const prevFuture = prevTs >= now - 24 * 60 * 60 * 1000
  const nextFuture = nextTs >= now - 24 * 60 * 60 * 1000

  if (prevFuture !== nextFuture) return nextFuture ? next : prev
  return nextTs >= prevTs ? next : prev
}

function maybeContentId(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 0
  return n
}

function collectPickupEndTimes(node, map) {
  if (!node) return

  if (Array.isArray(node)) {
    for (const item of node) collectPickupEndTimes(item, map)
    return
  }

  if (typeof node !== 'object') return

  const obj = node
  const id =
    maybeContentId(obj.content_id) ||
    maybeContentId(obj.contentId) ||
    maybeContentId(obj.review_content_id) ||
    0

  let endText = ''
  const keyPriority = [
    'end_time',
    'endTime',
    'deadline',
    'down_time',
    'over_time',
    '结束时间',
    '结束日期'
  ]

  for (const key of keyPriority) {
    if (obj[key] != null) {
      endText = extractDateLike(String(obj[key]))
      if (endText) break
    }
  }

  if (!endText) {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue
      if (!/(end|截止|结束|deadline|down|over)/i.test(k)) continue
      endText = extractDateLike(String(v))
      if (endText) break
    }
  }

  if (id && endText) {
    const existing = map.get(id) || ''
    map.set(id, pickBetterEndTime(existing, endText))
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      collectPickupEndTimes(value, map)
    }
  }
}

async function fetchPickupEndTimeMap(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && pickupEndTimeCache.byContentId.size > 0 && now < pickupEndTimeCache.expiresAt) {
    return pickupEndTimeCache.byContentId
  }

  const html = await fetchText(PICKUP_URL)
  const statePathMatch = html.match(STATE_PATH_RE)
  if (!statePathMatch) {
    pickupEndTimeCache = {
      byContentId: new Map(),
      expiresAt: now + UP_CACHE_TTL_MS
    }
    return pickupEndTimeCache.byContentId
  }

  const stateUrl = ensureAbsoluteUrl(statePathMatch[0])
  const stateText = await fetchText(stateUrl)
  const stateJson = JSON.parse(stateText.replace(/^window\.__INITIAL_STATE__\s*=\s*/, ''))
  const map = new Map()

  collectPickupEndTimes(stateJson?.ssrComponentData || [], map)

  pickupEndTimeCache = {
    byContentId: map,
    expiresAt: now + UP_CACHE_TTL_MS
  }
  return pickupEndTimeCache.byContentId
}

function buildReviewStyles(detail) {
  const eqRaw = detail?.content_tj_eq?.content
  const eq = typeof eqRaw === 'string' ? JSON.parse(eqRaw || '{}') : {}
  const styleKeys = Object.keys(eq).filter((key) => /^style\d+$/.test(key))
  const styles = []

  for (const key of styleKeys) {
    const index = Number(key.replace('style', ''))
    const style = eq[key] || {}
    const mustTakeRaw = getLocalizedRawText(style.must_take)
    const mustTakeValueRaw = getLocalizedRawText(style.must_take_value)
    const adviceRaw = getLocalizedRawText(style.adviceValue)
    const strengthRaw = getLocalizedRawText(style.strenthValue)
    const environmentRaw = getLocalizedRawText(style.environmentValue)
    const mustTake = getLocalizedText(style.must_take)
    const mustTakeValue = getLocalizedText(style.must_take_value)
    const advice = getLocalizedText(style.adviceValue)
    const strength = getLocalizedText(style.strenthValue)
    const environment = getLocalizedText(style.environmentValue)
    const level = getLocalizedText(style.level)
    const gjlLabel = getLocalizedText(style.gjlLabel) || '推图/塔'
    const gjlValue = getLocalizedText(style.gjlValue) || '-'
    const fylLabel = getLocalizedText(style.fylLabel) || 'BOSS'
    const fylValue = getLocalizedText(style.fylValue) || '-'
    const mflLabel = getLocalizedText(style.mflLabel) || '末日'
    const mflValue = getLocalizedText(style.mflValue) || '-'
    const pvpLabel = 'PVP'
    const pvpValue = getLocalizedText(style.pvpValue) || '-'
    const banner = ensureAbsoluteUrl(String(style['bannerImg_宣传图'] || '').trim())

    styles.push({
      index,
      level,
      mustTake,
      mustTakeValue,
      mustTakeRaw,
      mustTakeValueRaw,
      advice,
      adviceRaw,
      strength,
      strengthRaw,
      environment,
      environmentRaw,
      banner,
      scene: {
        gjlLabel,
        gjlValue,
        fylLabel,
        fylValue,
        mflLabel,
        mflValue,
        pvpLabel,
        pvpValue
      }
    })
  }

  styles.sort((a, b) => a.index - b.index)
  return styles
}

export async function getRoleReviewByContentId(contentId, forceRefresh = false) {
  if (!contentId) return null

  const cacheKey = String(contentId)
  const now = Date.now()
  const cached = reviewCache.get(cacheKey)

  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached
  }

  const reviewPage = `https://www.gamekee.com/zsca2/tj/${contentId}.html?tab=fzpc&style=style1`
  const pageHtml = await fetchText(reviewPage)
  const statePathMatch = pageHtml.match(STATE_PATH_RE)
  if (!statePathMatch) {
    throw new Error('failed to locate review SSR state URL')
  }

  const stateUrl = ensureAbsoluteUrl(statePathMatch[0])
  const stateText = await fetchText(stateUrl)
  const stateJson = JSON.parse(stateText.replace(/^window\.__INITIAL_STATE__\s*=\s*/, ''))
  const reviewComponent = (stateJson?.ssrComponentData || []).find(
    (item) => item?.componentName === REVIEW_PAGE_COMPONENT
  )

  if (!reviewComponent?.componentData) {
    throw new Error('failed to locate review component data')
  }

  const reviewData = JSON.parse(reviewComponent.componentData)
  const detail = reviewData?.detail || {}
  const styles = buildReviewStyles(detail)

  const payload = {
    contentId,
    title: String(detail?.title || '').trim(),
    pageUrl: reviewPage,
    styles,
    expiresAt: now + CACHE_TTL_MS
  }

  reviewCache.set(cacheKey, payload)
  return payload
}

export async function getRoleIndex(forceRefresh = false) {
  const now = Date.now()
  const cacheValid = roleCache.roles.length > 0 && now < roleCache.expiresAt

  if (!forceRefresh && cacheValid) {
    return roleCache
  }

  const fresh = await fetchRemoteRoles()
  roleCache = {
    roles: fresh.roles,
    updatedAt: fresh.updatedAt,
    expiresAt: now + CACHE_TTL_MS
  }

  return roleCache
}

export async function getRoleByContentId(contentId) {
  if (!contentId) return null
  const { roles } = await getRoleIndex(false)
  return roles.find((role) => String(role?.contentId) === String(contentId)) || null
}

export async function fetchCurrentUpReviews(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && currentUpCache.items.length > 0 && now < currentUpCache.expiresAt) {
    return currentUpCache.items
  }

  const homeHtml = await fetchText(HOME_URL)
  const section =
    homeHtml.match(/当前UP评测([\s\S]*?)当前版本攻略/)?.[1] ||
    homeHtml.match(/当前UP评测([\s\S]*?)服装测评/)?.[1] ||
    ''

  const source = section || homeHtml
  const anchorRe = /<a[^>]+href="([^"]*\/zsca2\/tj\/(\d+)\.html[^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  const seen = new Set()
  const items = []
  let match

  while ((match = anchorRe.exec(source)) !== null) {
    const href = ensureAbsoluteUrl(match[1])
    const contentId = Number(match[2])
    const rawAnchorText = stripHtmlTags(match[3])
    const title = rawAnchorText
      .replace(/(?:截止|截至|结束(?:于|时间)?|到期).*/i, '')
      .replace(/\d+\s*天/g, '')
      .trim() || rawAnchorText
    let endTime = extractUpEndTime(rawAnchorText)
    if (!endTime) {
      // Fallback: time text may sit outside <a>, extract from nearby snippet.
      const left = Math.max(0, match.index - 220)
      const right = Math.min(source.length, anchorRe.lastIndex + 320)
      const nearby = source.slice(left, right)
      endTime = extractUpEndTime(nearby)
    }
    if (!href || !contentId || !title || seen.has(href)) continue

    seen.add(href)
    const styleIndex = Number(href.match(/[?&]style=style(\d+)/)?.[1] || 1)
    items.push({
      title,
      href,
      contentId,
      styleIndex,
      endTime
    })
  }

  try {
    const endTimeMap = await fetchPickupEndTimeMap(forceRefresh)
    for (const item of items) {
      if (endTimeMap.has(item.contentId)) {
        item.endTime = pickBetterEndTime(item.endTime || '', endTimeMap.get(item.contentId) || '')
      }
    }
  } catch {
    // fallback to title-regex extracted endTime only
  }

  currentUpCache = {
    items,
    expiresAt: now + UP_CACHE_TTL_MS
  }

  return items
}

export async function searchRolesByName(keyword) {
  const normalizedKeyword = normalizeText(keyword)

  if (!normalizedKeyword) {
    return []
  }

  const { roles } = await getRoleIndex(false)
  const exact = []
  const fuzzy = []

  for (const role of roles) {
    if (!role?.name) continue

    if (role.normalizedName === normalizedKeyword) {
      exact.push(role)
      continue
    }

    if (role.normalizedName.includes(normalizedKeyword)) {
      fuzzy.push(role)
    }
  }

  return exact.length > 0 ? exact : fuzzy
}
