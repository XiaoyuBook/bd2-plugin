const ROLE_ATLAS_URL = 'https://www.gamekee.com/zsca2/jstj/122229?tab=jstj'
const STATE_PATH_RE = /ssr-vuex-store-state\.js\?cacheKey=[^"']+/
const ROLE_PAGE_COMPONENT = 'pageTjRole'
const CACHE_TTL_MS = 30 * 60 * 1000

let roleCache = {
  expiresAt: 0,
  roles: [],
  updatedAt: 0
}

function normalizeText(text = '') {
  return String(text).trim().toLowerCase().replace(/\s+/g, '')
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
          cd: String((skin?.skills?.strengthen?.find((item) => item?.name === '+0') || skin?.skills?.strengthen?.[0])?.cd || '').trim()
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
