import plugin from '../../../lib/plugins/plugin.js'
import { searchRolesByName } from '../model/gamekeeRoleService.js'

const HELP_TEXT = [
  '【BD2 Wiki 插件帮助】',
  '#bd2 搜索 <角色名>  按角色名查询并列出该角色全部皮肤',
  '#bd2 角色 <角色名>  与搜索等价',
  '#bd2 帮助'
].join('\n')

function trimSkillText(text = '', maxLength = 80) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
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

  lines.push('示例：#bd2 角色 角色名')
  return lines.join('\n')
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
          reg: '^#?bd2\s*帮助$',
          fnc: 'help'
        },
        {
          reg: '^#?bd2\s*(搜索|角色)\s*(.+)$',
          fnc: 'queryRole'
        }
      ]
    })
  }

  async help() {
    await this.reply(HELP_TEXT)
    return true
  }

  async queryRole(e) {
    const match = e.msg.match(/^#?bd2\s*(搜索|角色)\s*(.+)$/)
    const keyword = match?.[2]?.trim() || ''

    if (!keyword) {
      await this.reply('请输入角色名，例如：#bd2 搜索 奥利维耶')
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
