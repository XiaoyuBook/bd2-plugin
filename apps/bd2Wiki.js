import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import plugin from '../../../lib/plugins/plugin.js'
import { getRoleReviewByContentId, searchRolesByName } from '../model/gamekeeRoleService.js'
import { updateAtlasImageCache } from '../model/atlasImageCache.js'
import { renderReviewCard } from '../model/reviewCardRender.js'

const execAsync = promisify(exec)
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HELP_TEXT = [
  '【BD2 Wiki 插件帮助】',
  '#bd2 搜索 <角色名> / bd2 搜索 <角色名>  按角色名查询并列出该角色全部皮肤',
  '#bd2 角色 <角色名> / bd2 角色 <角色名>  与搜索等价',
  '#bd2 测评 <角色名> [皮肤序号] / bd2 测评 <角色名> [皮肤序号]',
  '#bd2更新  拉取当前分支最新代码（仅主人）',
  '#bd2图鉴更新 / #bd2 图鉴更新  更新本地皮肤头像缓存（仅主人）',
  '#bd2 帮助 / bd2 帮助'
].join('\n')

function trimSkillText(text = '', maxLength = 80) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function trimParagraph(text = '', maxLength = 280) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function formatRoleDetail(role) {
  const lines = []
  lines.push(`【BD2角色】${role.name}`)

  const meta = [role.star, role.attr, role.damage, role.birthday ? `生日 ${role.birthday}` : '']
    .filter(Boolean)
    .join(' | ')

  if (meta) {
    lines.push(meta)
  }

  lines.push(`皮肤总数：${role.skins.length}`)

  for (let i = 0; i < role.skins.length; i += 1) {
    const skin = role.skins[i]
    const header = `${i + 1}. ${skin.name || '未命名皮肤'}${skin.isInitial ? ' [初始]' : ''}`
    lines.push(header)

    const detail = [
      skin.sp ? `SP ${skin.sp}` : '',
      skin.cd ? `CD ${skin.cd}` : ''
    ]
      .filter(Boolean)
      .join(' | ')

    if (detail) {
      lines.push(`   ${detail}`)
    }

    const summary = trimSkillText(skin.skillSummary)
    if (summary) {
      lines.push(`   技能：${summary}`)
    }
  }

  lines.push(`词条：${role.roleUrl}`)
  lines.push('数据源：GameKee 角色图鉴')

  return lines.join('\n')
}

function formatDisambiguation(keyword, roles) {
  const lines = []
  lines.push(`【BD2搜索】“${keyword}” 命中多个角色，请输入更完整角色名：`)

  const maxCount = 12
  for (let i = 0; i < Math.min(roles.length, maxCount); i += 1) {
    const role = roles[i]
    lines.push(`${i + 1}. ${role.name}（皮肤 ${role.skins.length}）`)
  }

  if (roles.length > maxCount) {
    lines.push(`... 还有 ${roles.length - maxCount} 个结果`)
  }

  lines.push('示例：bd2 角色 角色名')
  return lines.join('\n')
}

function summarizeGitOutput(stdout = '', stderr = '') {
  const text = `${stdout}\n${stderr}`.trim()
  if (!text) return '无输出'
  return text.split('\n').slice(0, 6).join('\n')
}

function formatReviewDetail(role, style, skinName, pageUrl) {
  const lines = []
  lines.push(`【BD2测评】${role.name} - ${skinName || `皮肤${style.index}`}`)
  lines.push(`皮肤强度：${style.level || '未知'}`)
  lines.push(
    `${style.scene?.gjlLabel || '推图/塔'}：${style.scene?.gjlValue || '-'} | ` +
      `${style.scene?.fylLabel || 'BOSS'}：${style.scene?.fylValue || '-'} | ` +
      `${style.scene?.mflLabel || '末日'}：${style.scene?.mflValue || '-'} | ` +
      `${style.scene?.pvpLabel || 'PVP'}：${style.scene?.pvpValue || '-'}`
  )
  lines.push('')
  lines.push('抽取建议：')
  lines.push(trimParagraph([style.mustTake, style.mustTakeValue, style.advice].filter(Boolean).join('；') || '暂无'))
  lines.push('')
  lines.push('强度分析：')
  lines.push(trimParagraph(style.strength || '暂无'))
  lines.push('')
  lines.push('环境分析：')
  lines.push(trimParagraph(style.environment || '暂无'))
  lines.push('')
  lines.push(`来源：${pageUrl}`)
  return lines.join('\n')
}

async function replyImage(e, buffer) {
  const base64 = Buffer.from(buffer).toString('base64')
  if (typeof segment !== 'undefined' && segment?.image) {
    await e.reply(segment.image(`base64://${base64}`))
    return true
  }
  await e.reply(`base64://${base64}`)
  return true
}

export class Bd2Wiki extends plugin {
  constructor() {
    super({
      name: 'bd2-wiki',
      dsc: 'BD2 角色与皮肤查询',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?bd2',
          fnc: 'handleCommand'
        }
      ]
    })
  }

  async help() {
    await this.reply(HELP_TEXT)
    return true
  }

  async updatePlugin(e) {
    if (!e.isMaster) {
      await this.reply('仅Bot主人可执行 #bd2更新。')
      return true
    }

    await this.reply('开始更新 bd2-plugin，请稍候...')

    try {
      const { stdout, stderr } = await execAsync('git pull --ff-only', {
        cwd: PLUGIN_DIR,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      })

      const summary = summarizeGitOutput(stdout, stderr)
      const upToDate = /Already up to date|已经是最新|Already up-to-date/i.test(`${stdout}\n${stderr}`)

      if (upToDate) {
        await this.reply(`bd2-plugin 已是最新版本。\n${summary}`)
      } else {
        await this.reply(`bd2-plugin 更新完成，请重启云崽使新代码生效。\n${summary}`)
      }
      return true
    } catch (error) {
      logger.error('[bd2-plugin] update failed', error)
      await this.reply(`更新失败：${error.message || error}`)
      return true
    }
  }

  async updateAtlas(e) {
    if (!e.isMaster) {
      await this.reply('仅Bot主人可执行 #bd2图鉴更新。')
      return true
    }

    await this.reply('开始更新本地图鉴头像缓存，请稍候...')

    try {
      const stat = await updateAtlasImageCache(false)
      await this.reply(
        [
          '图鉴头像缓存更新完成。',
          `总计：${stat.total}`,
          `新增下载：${stat.downloaded}`,
          `已存在跳过：${stat.skipped}`,
          `失败：${stat.failed}`
        ].join('\n')
      )
      return true
    } catch (error) {
      logger.error('[bd2-plugin] atlas update failed', error)
      await this.reply(`图鉴更新失败：${error.message || error}`)
      return true
    }
  }

  async handleCommand(e) {
    const msg = String(e.msg || '').trim()

    if (/^#?bd2\s*帮助$/.test(msg)) {
      return this.help()
    }

    if (/^#bd2更新$/.test(msg)) {
      return this.updatePlugin(e)
    }

    if (/^#bd2\s*图鉴更新$/.test(msg)) {
      return this.updateAtlas(e)
    }

    const reviewMatch = msg.match(/^#?bd2\s*测评\s*(.+)$/)
    if (reviewMatch) {
      const payload = reviewMatch[1]?.trim() || ''
      const parsed = payload.match(/^(.*?)(?:\s+(\d+))?$/)
      const roleKeyword = parsed?.[1]?.trim() || ''
      const styleIndex = Number(parsed?.[2] || 1)

      if (!roleKeyword) {
        await this.reply('请输入角色名，例如：bd2 测评 奥利维耶 4')
        return true
      }

      try {
        const roles = await searchRolesByName(roleKeyword)
        if (!roles.length) {
          await this.reply(`未找到角色“${roleKeyword}”，请确认角色名后重试。`)
          return true
        }
        if (roles.length > 1) {
          await this.reply(formatDisambiguation(roleKeyword, roles))
          return true
        }

        const role = roles[0]
        const review = await getRoleReviewByContentId(role.contentId)
        const style = review?.styles?.find((item) => item.index === styleIndex) || review?.styles?.[0]

        if (!style) {
          await this.reply('未找到该角色测评数据。')
          return true
        }

        const skinName = role.skins?.[style.index - 1]?.name || ''
        const renderData = {
          roleName: role.name,
          skinName: skinName || `皮肤${style.index}`,
          roleIcon: role.icon || role.skins?.[style.index - 1]?.icon || role.skins?.[0]?.icon || '',
          level: style.level || '未知',
          mustTake: style.mustTake || '抽取建议待补充',
          mustTakeRaw: style.mustTakeRaw || '',
          mustTakeValue: style.mustTakeValue || '-',
          mustTakeValueRaw: style.mustTakeValueRaw || '',
          scene: style.scene || {},
          advice: style.advice || '暂无',
          adviceRaw: style.adviceRaw || '',
          strength: style.strength || '暂无',
          strengthRaw: style.strengthRaw || '',
          environment: style.environment || '暂无',
          environmentRaw: style.environmentRaw || '',
          banner: style.banner || ''
        }

        const imageBuffer = await renderReviewCard(renderData)
        if (imageBuffer) {
          await replyImage(e, imageBuffer)
          return true
        }

        await this.reply(formatReviewDetail(role, style, skinName, review.pageUrl))
        return true
      } catch (error) {
        logger.error('[bd2-plugin] review query failed', error)
        await this.reply('测评查询失败：数据源暂时不可用，请稍后重试。')
        return true
      }
    }

    const match = msg.match(/^#?bd2\s*(搜索|角色)\s*(.+)$/)
    if (!match) {
      await this.reply(HELP_TEXT)
      return true
    }

    const keyword = match[2]?.trim() || ''
    if (!keyword) {
      await this.reply('请输入角色名，例如：bd2 搜索 奥利维耶')
      return true
    }

    try {
      const roles = await searchRolesByName(keyword)

      if (!roles.length) {
        await this.reply(`未找到角色“${keyword}”，请确认角色名后重试。`)
        return true
      }

      if (roles.length > 1) {
        await this.reply(formatDisambiguation(keyword, roles))
        return true
      }

      await this.reply(formatRoleDetail(roles[0]))
      return true
    } catch (error) {
      logger.error('[bd2-plugin] role query failed', error)
      await this.reply('查询失败：数据源暂时不可用，请稍后重试。')
      return true
    }
  }
}
