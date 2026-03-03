import { toRenderableImageSrc } from './atlasImageCache.js'
const CARD_WIDTH = 1080

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function computeHeight(items = []) {
  const count = Math.max(1, items.length)
  const height = 320 + count * 92
  return Math.max(520, Math.min(1800, height))
}

function buildRows(items = []) {
  if (!items.length) {
    return '<div class="empty">暂未获取到当前UP测评列表，请稍后重试。</div>'
  }

  return items
    .map((item, idx) => {
      const title = escapeHtml(item?.title || '未知测评')
      const endTime = escapeHtml(item?.endTime || '未知')
      const avatar = escapeHtml(item?.avatar || '')
      const avatarNode = avatar
        ? `<img class="avatar" src="${avatar}" alt="avatar" />`
        : '<div class="avatar avatar-placeholder"></div>'
      return `<div class="row">
  <div class="index">${idx + 1}</div>
  ${avatarNode}
  <div class="main">
    <div class="title">${title}</div>
    <div class="end">结束：${endTime}</div>
  </div>
</div>`
    })
    .join('')
}

function buildHtml(items = []) {
  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${CARD_WIDTH}px;
    min-height: ${computeHeight(items)}px;
    font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #f8f4ef;
    background:
      radial-gradient(circle at 15% 10%, rgba(255, 178, 88, 0.2), transparent 36%),
      radial-gradient(circle at 82% 0%, rgba(255, 116, 96, 0.18), transparent 34%),
      linear-gradient(165deg, #1a130d 0%, #2a1a10 52%, #14100d 100%);
    padding: 34px;
  }
  .card {
    border-radius: 24px;
    border: 1px solid rgba(255, 215, 160, 0.28);
    background: rgba(19, 14, 10, 0.84);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.36);
    overflow: hidden;
  }
  .head {
    padding: 28px 30px 24px;
    border-bottom: 1px solid rgba(255, 215, 160, 0.2);
  }
  .title {
    font-size: 44px;
    font-weight: 800;
    letter-spacing: .5px;
  }
  .subtitle {
    margin-top: 10px;
    font-size: 22px;
    color: #f3cf9b;
  }
  .list {
    padding: 12px 20px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 18px 12px;
    border-radius: 14px;
  }
  .row:nth-child(odd) {
    background: rgba(255, 236, 210, 0.05);
  }
  .index {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: linear-gradient(145deg, #ffc778, #f09545);
    color: #2e1b0c;
    font-size: 24px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .avatar {
    width: 76px;
    height: 76px;
    border-radius: 14px;
    object-fit: cover;
    border: 1px solid rgba(255, 223, 180, 0.45);
    background: rgba(255, 255, 255, 0.1);
    flex: none;
  }
  .avatar-placeholder {
    background: linear-gradient(135deg, rgba(255, 210, 144, 0.28), rgba(255, 154, 87, 0.28));
  }
  .main .title {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.32;
    word-break: break-word;
  }
  .end {
    margin-top: 8px;
    font-size: 22px;
    color: #f1c683;
  }
  .empty {
    padding: 26px 10px 32px;
    font-size: 26px;
    color: #f3cf9b;
    text-align: center;
  }
  .footer {
    padding: 14px 28px 22px;
    font-size: 20px;
    color: rgba(255, 255, 255, 0.72);
    text-align: right;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="title">BD2 当前UP测评</div>
      <div class="subtitle">查看某条测评：示例 #bd2 up测评 1</div>
    </div>
    <div class="list">${buildRows(items)}</div>
    <div class="footer">数据来源：GameKee · 自动生成</div>
  </div>
</body>
</html>`
}

async function getPuppeteer() {
  const pkg = await import('puppeteer')
  return pkg?.default || pkg
}

async function normalizeItems(items = []) {
  return Promise.all(
    items.map(async (item) => {
      const avatar = await toRenderableImageSrc(item?.avatar || '')
      return { ...item, avatar }
    })
  )
}

export async function renderUpListCard(items = []) {
  try {
    const normalizedItems = await normalizeItems(items)
    const height = computeHeight(normalizedItems)
    const puppeteer = await getPuppeteer()
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    try {
      const page = await browser.newPage()
      await page.setViewport({ width: CARD_WIDTH, height, deviceScaleFactor: 1 })
      await page.setContent(buildHtml(normalizedItems), { waitUntil: 'networkidle0', timeout: 30000 })
      const buffer = await page.screenshot({ type: 'png', fullPage: true })
      await page.close()
      return buffer
    } finally {
      await browser.close()
    }
  } catch (error) {
    if (typeof logger !== 'undefined' && logger?.warn) {
      logger.warn('[bd2-plugin] renderUpListCard fallback to text', error)
    } else {
      console.warn('[bd2-plugin] renderUpListCard fallback to text', error?.message || error)
    }
    return null
  }
}
