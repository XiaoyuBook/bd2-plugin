const CARD_WIDTH = 1080
const CARD_HEIGHT = 1500

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildSection(title, items = []) {
  const rows = items
    .map((item) => {
      const name = escapeHtml(item?.name || '')
      const desc = escapeHtml(item?.desc || '')
      return `<div class="item">
  <div class="name">${name}</div>
  <div class="desc">${desc}</div>
</div>`
    })
    .join('')

  return `<section class="section">
  <div class="section-title">${escapeHtml(title)}</div>
  <div class="grid">${rows}</div>
</section>`
}

function buildHtml() {
  const queryItems = [
    { name: '#bd2 搜索 <角色名>', desc: '按角色查询并返回该角色全部皮肤' },
    { name: '#bd2 角色 <角色名>', desc: '与搜索命令等价' },
    { name: '#bd2 测评 <角色名> [序号]', desc: '返回抽取建议/强度分析/环境分析' },
    { name: '#bd2 当前up测评', desc: '查看当前UP测评列表（图片优先）' },
    { name: '#bd2 up测评 <序号>', desc: '查看指定序号测评详情（图片优先）' }
  ]

  const pushItems = [
    { name: '#bd2开启推送', desc: '当前群开启UP新增自动推送（仅主人）' },
    { name: '#bd2关闭推送', desc: '当前群关闭UP新增自动推送（仅主人）' },
    { name: '#bd2 推送状态', desc: '查看当前群推送状态（仅主人）' },
    { name: '自动检查频率', desc: '每1小时检查一次，检测新增后自动推送' }
  ]

  const maintItems = [
    { name: '#bd2更新', desc: '拉取当前分支最新代码（仅主人）' },
    { name: '#bd2图鉴更新', desc: '刷新本地皮肤头像缓存（仅主人）' },
    { name: '#bd2 帮助', desc: '查看本帮助图，渲染失败时回退文字' }
  ]

  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${CARD_WIDTH}px;
    height: ${CARD_HEIGHT}px;
    overflow: hidden;
    font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #f6efe5;
    background:
      radial-gradient(circle at 14% 8%, rgba(255, 170, 128, 0.32), transparent 34%),
      radial-gradient(circle at 90% 0%, rgba(255, 220, 170, 0.26), transparent 36%),
      linear-gradient(165deg, #22160f 0%, #3a2517 48%, #1b120e 100%);
    padding: 34px;
  }
  .card {
    width: 100%;
    height: 100%;
    border-radius: 26px;
    border: 1px solid rgba(255, 220, 170, 0.35);
    background: rgba(25, 17, 13, 0.82);
    box-shadow: 0 24px 56px rgba(0, 0, 0, 0.42);
    padding: 28px;
  }
  .head {
    padding: 6px 2px 18px;
    border-bottom: 1px solid rgba(255, 220, 170, 0.24);
    margin-bottom: 16px;
  }
  .title {
    font-size: 56px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 1px;
  }
  .sub {
    margin-top: 10px;
    font-size: 22px;
    color: #f2cfa1;
  }
  .section {
    border-radius: 18px;
    border: 1px solid rgba(255, 220, 170, 0.22);
    background: rgba(255, 245, 230, 0.03);
    margin-top: 16px;
    overflow: hidden;
  }
  .section-title {
    padding: 12px 16px;
    font-size: 26px;
    font-weight: 700;
    color: #ffd79c;
    background: rgba(255, 208, 145, 0.08);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .item {
    min-height: 96px;
    padding: 14px 16px;
    border-top: 1px solid rgba(255, 220, 170, 0.16);
  }
  .item:nth-child(odd) {
    border-right: 1px solid rgba(255, 220, 170, 0.16);
  }
  .name {
    font-size: 23px;
    color: #ffe5bf;
    font-weight: 700;
    line-height: 1.35;
    word-break: break-word;
  }
  .desc {
    margin-top: 6px;
    font-size: 19px;
    color: rgba(246, 239, 229, 0.84);
    line-height: 1.5;
    word-break: break-word;
  }
  .footer {
    margin-top: 20px;
    text-align: right;
    font-size: 18px;
    color: rgba(246, 239, 229, 0.62);
  }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="title">BD2 帮助</div>
      <div class="sub">查询、测评、当前UP与自动推送命令总览</div>
    </div>
    ${buildSection('角色与测评查询', queryItems)}
    ${buildSection('自动推送', pushItems)}
    ${buildSection('维护命令', maintItems)}
    <div class="footer">bd2-plugin · help card</div>
  </div>
</body>
</html>`
}

async function getPuppeteer() {
  const pkg = await import('puppeteer')
  return pkg?.default || pkg
}

export async function renderHelpCard() {
  try {
    const puppeteer = await getPuppeteer()
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    try {
      const page = await browser.newPage()
      await page.setViewport({ width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 })
      await page.setContent(buildHtml(), { waitUntil: 'networkidle0', timeout: 30000 })
      const buffer = await page.screenshot({ type: 'png', fullPage: true })
      await page.close()
      return buffer
    } finally {
      await browser.close()
    }
  } catch (error) {
    if (typeof logger !== 'undefined' && logger?.warn) {
      logger.warn('[bd2-plugin] renderHelpCard fallback to text', error)
    } else {
      console.warn('[bd2-plugin] renderHelpCard fallback to text', error?.message || error)
    }
    return null
  }
}
