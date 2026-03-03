import { toRenderableImageSrc } from './atlasImageCache.js'
const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1520

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function colorClass(color = '') {
  const name = String(color || '').toLowerCase()
  const map = {
    orange: 'mk-orange',
    red: 'mk-red',
    yellow: 'mk-yellow',
    green: 'mk-green',
    blue: 'mk-blue'
  }
  return map[name] || ''
}

function renderMarkedText(raw = '', fallback = '') {
  const input = String(raw || fallback || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')

  const pattern = /\*{3}([a-zA-Z]+)(?:\s+)?([\s\S]*?)\*{3}/g
  let lastIndex = 0
  let result = ''
  let match

  while ((match = pattern.exec(input)) !== null) {
    result += escapeHtml(input.slice(lastIndex, match.index))

    const cls = colorClass(match[1])
    const inner = escapeHtml(match[2] || '')
    result += cls ? `<span class="${cls}">${inner}</span>` : inner
    lastIndex = pattern.lastIndex
  }

  result += escapeHtml(input.slice(lastIndex))
  result = result
    .replace(/\*{3}[a-zA-Z]+/g, '')
    .replace(/\*{3}/g, '')
    .replace(/\n/g, '<br/>')

  return result.trim()
}

function buildHtml(data) {
  const {
    roleName,
    skinName,
    roleIcon,
    level,
    mustTake,
    mustTakeRaw,
    mustTakeValue,
    mustTakeValueRaw,
    scene,
    advice,
    adviceRaw,
    strength,
    strengthRaw,
    environment,
    environmentRaw,
    banner
  } = data

  const bg = banner || 'linear-gradient(145deg,#2a1d12,#3f2a18,#1f140c)'

  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${DEFAULT_WIDTH}px;
    height: ${DEFAULT_HEIGHT}px;
    font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #fff;
    background: #120d09;
  }
  .card {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #1a120c;
  }
  .bg {
    position: absolute;
    inset: 0;
    background: ${bg.startsWith('http') ? `url('${bg}') center/cover no-repeat` : bg};
    filter: brightness(0.35) saturate(1.1);
  }
  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(14,10,6,.80), rgba(20,13,8,.94));
  }
  .content {
    position: relative;
    z-index: 2;
    padding: 40px 42px;
  }
  .top {
    position: relative;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .avatar {
    width: 168px;
    height: 168px;
    border-radius: 20px;
    border: 2px solid rgba(255,210,145,.65);
    object-fit: cover;
    background: rgba(255,255,255,.08);
  }
  .title-wrap { flex: 1; }
  .title {
    font-size: 44px;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: .5px;
    text-shadow: 0 4px 18px rgba(0,0,0,.5);
  }
  .sub {
    margin-top: 10px;
    font-size: 22px;
    color: #f9ddb5;
  }
  .level-corner {
    position: absolute;
    top: 0;
    right: 0;
    padding: 9px 14px 10px;
    border-radius: 12px;
    background: rgba(72,12,8,.78);
    border: 1px solid rgba(255,130,110,.75);
    text-align: right;
    box-shadow: 0 5px 16px rgba(0,0,0,.28);
  }
  .level-k {
    font-size: 16px;
    color: #ffc2b7;
    line-height: 1;
  }
  .level-v {
    margin-top: 8px;
    font-size: 34px;
    line-height: 1;
    font-weight: 800;
    color: #ff4a3c;
    text-shadow: 0 3px 10px rgba(90,0,0,.45);
  }
  .chips {
    margin-top: 26px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 22px;
    font-weight: 700;
  }
  .chip-main {
    background: linear-gradient(135deg,#f5c16b,#d88f35);
    color: #281708;
  }
  .chip-sub {
    background: rgba(255,255,255,.13);
    border: 1px solid rgba(255,255,255,.25);
  }
  .score-row {
    margin-top: 20px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  .score-item {
    background: rgba(30,20,12,.72);
    border: 1px solid rgba(255,220,160,.26);
    border-radius: 14px;
    padding: 12px;
    min-height: 84px;
  }
  .score-k {
    font-size: 18px;
    color: #efd8b7;
  }
  .score-v {
    margin-top: 6px;
    font-size: 26px;
    font-weight: 700;
    color: #fff4df;
  }
  .section {
    margin-top: 20px;
    background: rgba(26,18,10,.75);
    border: 1px solid rgba(255,220,160,.26);
    border-radius: 18px;
    padding: 20px 22px 18px;
  }
  .section h3 {
    font-size: 28px;
    color: #ffd28e;
    margin-bottom: 10px;
  }
  .section p {
    font-size: 22px;
    line-height: 1.7;
    color: #fff;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .mk-orange { color: #ffb347; font-weight: 700; }
  .mk-red { color: #ff6b6b; font-weight: 700; }
  .mk-yellow { color: #ffe082; font-weight: 700; }
  .mk-green { color: #8ce99a; font-weight: 700; }
  .mk-blue { color: #82cfff; font-weight: 700; }
  .footer {
    margin-top: 14px;
    font-size: 16px;
    color: rgba(255,255,255,.72);
    text-align: right;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="bg"></div>
    <div class="overlay"></div>
    <div class="content">
      <div class="top">
        <img class="avatar" src="${escapeHtml(roleIcon)}" alt="avatar" />
        <div class="title-wrap">
          <div class="title">${escapeHtml(skinName)} · ${escapeHtml(roleName)}</div>
          <div class="sub">皮肤测评卡</div>
        </div>
        <div class="level-corner">
          <div class="level-k">皮肤强度</div>
          <div class="level-v">${escapeHtml(level || '未知')}</div>
        </div>
      </div>

      <div class="chips">
        <div class="chip chip-main">${renderMarkedText(mustTakeRaw, mustTake || '抽取建议待补充')}</div>
        <div class="chip chip-sub">${renderMarkedText(mustTakeValueRaw, mustTakeValue || '-')}</div>
      </div>

      <div class="score-row">
        <div class="score-item"><div class="score-k">${escapeHtml(scene.gjlLabel || '推图/塔')}</div><div class="score-v">${escapeHtml(scene.gjlValue || '-')}</div></div>
        <div class="score-item"><div class="score-k">${escapeHtml(scene.fylLabel || 'BOSS')}</div><div class="score-v">${escapeHtml(scene.fylValue || '-')}</div></div>
        <div class="score-item"><div class="score-k">${escapeHtml(scene.mflLabel || '末日')}</div><div class="score-v">${escapeHtml(scene.mflValue || '-')}</div></div>
        <div class="score-item"><div class="score-k">${escapeHtml(scene.pvpLabel || 'PVP')}</div><div class="score-v">${escapeHtml(scene.pvpValue || '-')}</div></div>
      </div>

      <div class="section">
        <h3>抽取建议</h3>
        <p>${renderMarkedText(adviceRaw, advice || '暂无')}</p>
      </div>

      <div class="section">
        <h3>强度分析</h3>
        <p>${renderMarkedText(strengthRaw, strength || '暂无')}</p>
      </div>

      <div class="section">
        <h3>环境分析</h3>
        <p>${renderMarkedText(environmentRaw, environment || '暂无')}</p>
      </div>

      <div class="footer">数据来源：GameKee · 自动生成</div>
    </div>
  </div>
</body>
</html>`
}

async function getPuppeteer() {
  const pkg = await import('puppeteer')
  return pkg?.default || pkg
}

export async function renderReviewCard(data) {
  try {
    const roleIcon = await toRenderableImageSrc(data?.roleIcon || '')
    const puppeteer = await getPuppeteer()
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    try {
      const page = await browser.newPage()
      await page.setViewport({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, deviceScaleFactor: 1 })
      await page.setContent(buildHtml({ ...data, roleIcon }), { waitUntil: 'networkidle0', timeout: 30000 })
      const buffer = await page.screenshot({ type: 'png' })
      await page.close()
      return buffer
    } finally {
      await browser.close()
    }
  } catch (error) {
    if (typeof logger !== 'undefined' && logger?.warn) {
      logger.warn('[bd2-plugin] renderReviewCard fallback to text', error)
    } else {
      console.warn('[bd2-plugin] renderReviewCard fallback to text', error?.message || error)
    }
    return null
  }
}
