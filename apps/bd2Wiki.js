import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import plugin from '../../../lib/plugins/plugin.js'
import { searchRolesByName } from '../model/gamekeeRoleService.js'

const execAsync = promisify(exec)
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HELP_TEXT = [
  '【BD2 Wiki 插件帮助】',
  '#bd2 搜索 <角色名>  按角色名查询并列出该角色全部皮肤',
  '#bd2 角色 <角色名>  与搜索等价',
  '#bd2 更新  拉取当前分支最新代码（仅主人）',
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

function summarizeGitOutput(stdout = '', stderr = '') {
  const text = `${stdout}\n${stderr}`.trim()
  if (!text) return '无输出'
  return text.split('\n').slice(0, 6).join('\n')
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
      await this.reply('仅Bot主人可执行 #bd2 更新。')
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

  async handleCommand(e) {
    const msg = String(e.msg || '').trim()

    if (/^#?bd2\s*帮助$/.test(msg)) {
      return this.help()
    }

    if (/^#?bd2\s*更新$/.test(msg)) {
      return this.updatePlugin(e)
    }

    const match = msg.match(/^#?bd2\s*(搜索|角色)\s*(.+)$/)
    if (!match) {
      await this.reply(HELP_TEXT)
      return true
    }

    const keyword = match[2]?.trim() || ''
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
