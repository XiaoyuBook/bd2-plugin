import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import plugin from '../../../lib/plugins/plugin.js'
import {
  fetchCurrentUpReviews,
  getRoleByContentId,
  getRoleReviewByContentId,
  searchRolesByName
} from '../model/gamekeeRoleService.js'
import { updateAtlasImageCache } from '../model/atlasImageCache.js'
import { renderReviewCard } from '../model/reviewCardRender.js'
import { renderUpListCard } from '../model/upListRender.js'
import { renderHelpCard } from '../model/helpCardRender.js'

const execAsync = promisify(exec)
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(PLUGIN_DIR, 'data')
const PUSH_STATE_FILE = path.join(DATA_DIR, 'up-push-state.json')
const LOG_DIR = path.join(DATA_DIR, 'logs')
const LOG_FILE_PREFIX = 'bd2-ops-'

const HELP_TEXT = [
  '【BD2 Wiki 插件帮助】',
  '#bd2 搜索 <角色名> / bd2 搜索 <角色名>  按角色名查询并列出该角色全部皮肤',
  '#bd2 角色 <角色名> / bd2 角色 <角色名>  与搜索等价',
  '#bd2 测评 <角色名> [皮肤序号] / bd2 测评 <角色名> [皮肤序号]',
  '#bd2 当前up测评  列出当前UP测评列表（带序号）',
  '#bd2 up测评 <序号> / #bd2 当前up测评 <序号>  按序号查看测评',
  '#bd2开启推送 / #bd2 关闭推送  当前群开启/关闭UP新增推送（仅主人）',
  '#bd2 推送状态  查看当前群推送状态（仅主人）',
  '#bd2更新  拉取当前分支最新代码（仅主人）',
  '#bd2图鉴更新 / #bd2 图鉴更新  更新本地皮肤头像缓存（仅主人）',
  '#bd2 帮助 / bd2 帮助'
].join('\n')

let pushStateCache = null

function upItemKey(item) {
  return `${item?.contentId || 0}:${item?.styleIndex || 1}`
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

function twoDigits(num) {
  return String(num).padStart(2, '0')
}

function dateStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = twoDigits(date.getMonth() + 1)
  const d = twoDigits(date.getDate())
  return `${y}-${m}-${d}`
}

function timeStamp(date = new Date()) {
  const h = twoDigits(date.getHours())
  const m = twoDigits(date.getMinutes())
  const s = twoDigits(date.getSeconds())
  return `${h}:${m}:${s}`
}

async function cleanupOldOpLogs() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true })
    const files = await fs.readdir(LOG_DIR)
    const targets = files
      .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith('.log'))
      .sort()

    if (targets.length <= 3) return

    const removeList = targets.slice(0, targets.length - 3)
    await Promise.all(removeList.map((name) => fs.unlink(path.join(LOG_DIR, name)).catch(() => null)))
  } catch {
    // keep silent: file logging should never break plugin flow
  }
}

async function writeOpLog(message = '') {
  try {
    const now = new Date()
    const day = dateStamp(now)
    const line = `[${day} ${timeStamp(now)}] ${message}\n`
    await fs.mkdir(LOG_DIR, { recursive: true })
    const filePath = path.join(LOG_DIR, `${LOG_FILE_PREFIX}${day}.log`)
    await fs.appendFile(filePath, line, 'utf8')
    await cleanupOldOpLogs()
  } catch {
    // keep silent: file logging should never break plugin flow
  }
}

async function loadPushState() {
  if (pushStateCache) return pushStateCache

  try {
    const text = await fs.readFile(PUSH_STATE_FILE, 'utf8')
    const parsed = JSON.parse(text)
    pushStateCache = {
      enabledGroups: Array.isArray(parsed?.enabledGroups)
        ? parsed.enabledGroups.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
        : [],
      lastKeys: Array.isArray(parsed?.lastKeys) ? parsed.lastKeys.map((v) => String(v)) : []
    }
  } catch {
    pushStateCache = {
      enabledGroups: [],
      lastKeys: []
    }
  }

  return pushStateCache
}

async function savePushState(state) {
  pushStateCache = {
    enabledGroups: Array.isArray(state?.enabledGroups)
      ? state.enabledGroups.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
      : [],
    lastKeys: Array.isArray(state?.lastKeys) ? state.lastKeys.map((v) => String(v)) : []
  }

  await ensureDataDir()
  await fs.writeFile(PUSH_STATE_FILE, JSON.stringify(pushStateCache, null, 2), 'utf8')
}

async function buildUpItemsWithAvatar(items) {
  return Promise.all(
    (items || []).map(async (item) => {
      try {
        const role = await getRoleByContentId(item.contentId)
        const skinIndex = Number(item.styleIndex || 1) - 1
        const avatar = role?.skins?.[skinIndex]?.icon || role?.skins?.[0]?.icon || role?.icon || ''
        return { ...item, avatar }
      } catch {
        return { ...item, avatar: '' }
      }
    })
  )
}

function imageSegmentFromBuffer(buffer) {
  const base64 = Buffer.from(buffer).toString('base64')
  if (typeof segment !== 'undefined' && segment?.image) {
    return segment.image(`base64://${base64}`)
  }
  return `base64://${base64}`
}

async function sendGroupPush(groupId, message) {
  if (typeof Bot === 'undefined' || !Bot?.pickGroup) return false
  const group = Bot.pickGroup(Number(groupId))
  if (!group?.sendMsg) return false
  await group.sendMsg(message)
  return true
}

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

function formatCurrentUpList(items) {
  const lines = []
  lines.push('【BD2 当前UP测评】')

  if (!items.length) {
    lines.push('暂未获取到当前UP测评列表，请稍后重试。')
    return lines.join('\n')
  }

  for (let i = 0; i < items.length; i += 1) {
    const endText = `（结束：${items[i].endTime || '未知'}）`
    lines.push(`${i + 1}. ${items[i].title}${endText}`)
  }

  lines.push('')
  lines.push('查看某条测评：')
  lines.push('示例：#bd2 up测评 1')
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
      task: [
        {
          cron: '0 0 * * * *',
          name: 'bd2-up-push-check',
          fnc: 'checkUpPushTask'
        }
      ],
      rule: [
        {
          reg: '^#?bd2',
          fnc: 'handleCommand'
        }
      ]
    })
  }

  async help() {
    try {
      const imageBuffer = await renderHelpCard()
      if (imageBuffer) {
        await writeOpLog('help image')
        await this.reply(imageSegmentFromBuffer(imageBuffer))
        return true
      }
    } catch (error) {
      logger.warn('[bd2-plugin] help card render failed', error?.message || error)
      await writeOpLog(`help image-failed error=${error?.message || error}`)
    }

    await writeOpLog('help text-fallback')
    await this.reply(HELP_TEXT)
    return true
  }

  async updatePlugin(e) {
    if (!e.isMaster) {
      await writeOpLog(`update denied user=${e.user_id || 0}`)
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
        await writeOpLog('update done up-to-date')
        await this.reply(`bd2-plugin 已是最新版本。\n${summary}`)
      } else {
        await writeOpLog('update done pulled')
        await this.reply(`bd2-plugin 更新完成，请重启云崽使新代码生效。\n${summary}`)
      }
      return true
    } catch (error) {
      logger.error('[bd2-plugin] update failed', error)
      await writeOpLog(`update failed error=${error?.message || error}`)
      await this.reply(`更新失败：${error.message || error}`)
      return true
    }
  }

  async updateAtlas(e) {
    if (!e.isMaster) {
      await writeOpLog(`atlas denied user=${e.user_id || 0}`)
      await this.reply('仅Bot主人可执行 #bd2图鉴更新。')
      return true
    }

    await this.reply('开始更新本地图鉴头像缓存，请稍候...')

    try {
      const stat = await updateAtlasImageCache(false)
      await writeOpLog(
        `atlas done total=${stat.total} downloaded=${stat.downloaded} skipped=${stat.skipped} failed=${stat.failed}`
      )
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
      await writeOpLog(`atlas failed error=${error?.message || error}`)
      await this.reply(`图鉴更新失败：${error.message || error}`)
      return true
    }
  }

  async enableUpPush(e) {
    if (!e.isMaster) {
      await writeOpLog(`push-enable denied user=${e.user_id || 0}`)
      await this.reply('仅Bot主人可执行 #bd2开启推送。')
      return true
    }
    if (!e.isGroup) {
      await writeOpLog('push-enable denied not-group')
      await this.reply('请在群聊中执行该命令。')
      return true
    }

    const state = await loadPushState()
    const gid = Number(e.group_id)

    if (!state.enabledGroups.includes(gid)) {
      state.enabledGroups.push(gid)
      await savePushState(state)
      await writeOpLog(`push-enable group=${gid}`)
      await this.reply('BD2 当前UP新增推送已开启。')
      return true
    }

    await writeOpLog(`push-enable already group=${gid}`)
    await this.reply('当前群已开启UP新增推送。')
    return true
  }

  async disableUpPush(e) {
    if (!e.isMaster) {
      await writeOpLog(`push-disable denied user=${e.user_id || 0}`)
      await this.reply('仅Bot主人可执行 #bd2关闭推送。')
      return true
    }
    if (!e.isGroup) {
      await writeOpLog('push-disable denied not-group')
      await this.reply('请在群聊中执行该命令。')
      return true
    }

    const state = await loadPushState()
    const gid = Number(e.group_id)
    const nextGroups = state.enabledGroups.filter((v) => v !== gid)

    if (nextGroups.length !== state.enabledGroups.length) {
      state.enabledGroups = nextGroups
      await savePushState(state)
      await writeOpLog(`push-disable group=${gid}`)
      await this.reply('BD2 当前UP新增推送已关闭。')
      return true
    }

    await writeOpLog(`push-disable not-enabled group=${gid}`)
    await this.reply('当前群未开启UP新增推送。')
    return true
  }

  async showUpPushStatus(e) {
    if (!e.isMaster) {
      await writeOpLog(`push-status denied user=${e.user_id || 0}`)
      await this.reply('仅Bot主人可查看推送状态。')
      return true
    }
    if (!e.isGroup) {
      await writeOpLog('push-status denied not-group')
      await this.reply('请在群聊中执行该命令。')
      return true
    }

    const state = await loadPushState()
    const gid = Number(e.group_id)
    const enabled = state.enabledGroups.includes(gid)
    await writeOpLog(`push-status group=${gid} enabled=${enabled ? 1 : 0}`)
    await this.reply(enabled ? '当前群UP新增推送：已开启。' : '当前群UP新增推送：未开启。')
    return true
  }

  async runUpPushCheckNow(e) {
    if (!e.isMaster) {
      await writeOpLog(`push-check-now denied user=${e.user_id || 0}`)
      await this.reply('仅Bot主人可执行 #bd2推送检查。')
      return true
    }
    await writeOpLog('push-check-now start')
    await this.reply('开始执行一次UP推送检查，请稍候...')
    await this.checkUpPushTask()
    await writeOpLog('push-check-now done')
    await this.reply('UP推送检查执行完成，请查看日志与状态文件。')
    return true
  }

  async checkUpPushTask() {
    try {
      const state = await loadPushState()
      if (!state.enabledGroups.length) return true

      logger.mark(
        '[bd2-plugin] up push task tick',
        `enabledGroups=${state.enabledGroups.length}`
      )
      await writeOpLog(`task-tick enabledGroups=${state.enabledGroups.length}`)

      const upItems = await fetchCurrentUpReviews(false)
      const currentKeys = upItems.map((item) => upItemKey(item))
      const previousKeys = new Set(state.lastKeys || [])

      if (!previousKeys.size) {
        state.lastKeys = currentKeys
        await savePushState(state)
        await writeOpLog(`task-snapshot-init upItems=${upItems.length} savedKeys=${currentKeys.length}`)
        return true
      }

      const newItems = upItems.filter((item) => !previousKeys.has(upItemKey(item)))
      state.lastKeys = currentKeys
      await savePushState(state)

      logger.mark(
        '[bd2-plugin] up push task scan',
        `upItems=${upItems.length} newItems=${newItems.length}`
      )
      await writeOpLog(`task-scan upItems=${upItems.length} newItems=${newItems.length}`)

      if (!newItems.length) return true

      try {
        const stat = await updateAtlasImageCache(false)
        logger.mark(
          '[bd2-plugin] auto atlas update before up push',
          `total=${stat.total} downloaded=${stat.downloaded} skipped=${stat.skipped} failed=${stat.failed}`
        )
        await writeOpLog(
          `atlas total=${stat.total} downloaded=${stat.downloaded} skipped=${stat.skipped} failed=${stat.failed}`
        )
      } catch (error) {
        logger.warn('[bd2-plugin] auto atlas update failed before up push', error?.message || error)
        await writeOpLog(`task-atlas-failed error=${error?.message || error}`)
      }

      const textLines = ['【BD2 当前UP新增推送】']
      for (let i = 0; i < newItems.length; i += 1) {
        const item = newItems[i]
        const end = item.endTime ? `（结束：${item.endTime}）` : ''
        textLines.push(`${i + 1}. ${item.title}${end}`)
      }
      textLines.push('查看详情：#bd2 当前up测评')
      const textMessage = textLines.join('\n')

      let imageMessage = null
      try {
        const itemsWithAvatar = await buildUpItemsWithAvatar(upItems)
        const imageBuffer = await renderUpListCard(itemsWithAvatar)
        if (imageBuffer) {
          imageMessage = imageSegmentFromBuffer(imageBuffer)
        }
      } catch {
        imageMessage = null
      }

      const detailImageMessages = []
      for (const item of newItems) {
        try {
          const review = await getRoleReviewByContentId(item.contentId)
          const style = review?.styles?.find((it) => it.index === item.styleIndex) || review?.styles?.[0]
          if (!style) continue

          const role = await getRoleByContentId(item.contentId)
          const roleName = role?.name || item.title
          const skinName = role?.skins?.[style.index - 1]?.name || `皮肤${style.index}`
          const renderData = {
            roleName,
            skinName,
            roleIcon: role?.skins?.[style.index - 1]?.icon || role?.skins?.[0]?.icon || role?.icon || '',
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

          const detailBuffer = await renderReviewCard(renderData)
          if (detailBuffer) {
            detailImageMessages.push(imageSegmentFromBuffer(detailBuffer))
          }
        } catch (error) {
          logger.warn('[bd2-plugin] up push detail render failed', item?.title || item?.contentId, error?.message || error)
        }
      }

      for (const gid of state.enabledGroups) {
        try {
          await sendGroupPush(gid, textMessage)
          if (imageMessage) {
            await sendGroupPush(gid, imageMessage)
          }
          for (const detailImage of detailImageMessages) {
            await sendGroupPush(gid, detailImage)
          }
          await writeOpLog(
            `push-ok group=${gid} newItems=${newItems.length} detailImages=${detailImageMessages.length}`
          )
        } catch (error) {
          logger.warn('[bd2-plugin] up push failed', gid, error?.message || error)
          await writeOpLog(`task-push-failed group=${gid} error=${error?.message || error}`)
        }
      }
    } catch (error) {
      logger.warn('[bd2-plugin] up push task failed', error?.message || error)
      await writeOpLog(`task-failed error=${error?.message || error}`)
    }

    return true
  }

  async handleCommand(e) {
    const msg = String(e.msg || '').trim()
    await writeOpLog(
      `cmd user=${e.user_id || 0} group=${e.group_id || 0} isGroup=${e.isGroup ? 1 : 0} msg=${msg.replace(/\s+/g, ' ').slice(0, 160)}`
    )

    if (/^#?bd2\s*帮助$/.test(msg)) {
      return this.help()
    }

    if (/^#bd2更新$/.test(msg)) {
      return this.updatePlugin(e)
    }

    if (/^#bd2\s*图鉴更新$/.test(msg)) {
      return this.updateAtlas(e)
    }

    if (/^#bd2\s*开启推送$/.test(msg)) {
      return this.enableUpPush(e)
    }

    if (/^#bd2\s*关闭推送$/.test(msg)) {
      return this.disableUpPush(e)
    }

    if (/^#bd2\s*推送状态$/.test(msg)) {
      return this.showUpPushStatus(e)
    }

    if (/^#bd2\s*推送检查$/.test(msg)) {
      return this.runUpPushCheckNow(e)
    }

    const upListMatch = msg.match(/^#?bd2\s*当前\s*up测评(?:\s*(\d+))?$/i)
    const upPickMatch = msg.match(/^#?bd2\s*up测评\s*(\d+)$/i)
    if (upListMatch || upPickMatch) {
      const pickedIndex = Number(upPickMatch?.[1] || upListMatch?.[1] || 0)

      try {
        const upItems = await fetchCurrentUpReviews(false)
        if (!pickedIndex) {
          const upItemsWithAvatar = await buildUpItemsWithAvatar(upItems)

          const listImageBuffer = await renderUpListCard(upItemsWithAvatar)
          if (listImageBuffer) {
            await replyImage(e, listImageBuffer)
            return true
          }
          await this.reply(formatCurrentUpList(upItems))
          return true
        }

        if (!Number.isInteger(pickedIndex) || pickedIndex < 1 || pickedIndex > upItems.length) {
          await this.reply(`序号无效，请输入 1-${upItems.length} 之间的数字。`)
          return true
        }

        const picked = upItems[pickedIndex - 1]
        const review = await getRoleReviewByContentId(picked.contentId)
        const style = review?.styles?.find((item) => item.index === picked.styleIndex) || review?.styles?.[0]
        if (!style) {
          await this.reply('未找到该UP测评数据。')
          return true
        }

        const role = await getRoleByContentId(picked.contentId)
        const roleName = role?.name || picked.title
        const skinName = role?.skins?.[style.index - 1]?.name || `皮肤${style.index}`
        const renderData = {
          roleName,
          skinName,
          roleIcon: role?.skins?.[style.index - 1]?.icon || role?.skins?.[0]?.icon || role?.icon || '',
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

        await this.reply(formatReviewDetail({ name: roleName }, style, skinName, picked.href || review.pageUrl))
        return true
      } catch (error) {
        logger.error('[bd2-plugin] up review query failed', error)
        await this.reply('当前UP测评查询失败：数据源暂时不可用，请稍后重试。')
        return true
      }
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
