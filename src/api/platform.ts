import { http } from './http'

/**
 * §5.1 变更窗口（平台级特性开关）。enabled=true 时仅允许窗口内触发新运行：
 * 前端在触发弹窗预拦截（提示 + 禁用按钮），hub 在 Trigger 入口强校验（409）。
 */

export interface ChangeWindow {
  enabled: boolean
  start: string // "HH:MM"
  end: string // "HH:MM"
  weekdays?: number[] // 0=周日…6=周六；空 = 每天
}

export const platformApi = {
  getChangeWindow: () =>
    http.get<{ data: ChangeWindow }>('/platform/settings/change-window').then((r) => r.data.data),
  updateChangeWindow: (cw: ChangeWindow) =>
    http.put<{ data: ChangeWindow }>('/platform/settings/change-window', cw).then((r) => r.data.data),
}

/** "HH:MM" → 当日分钟数；非法返回 NaN。 */
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return h * 60 + mi
}

/**
 * 与 hub `platform.InWindow` 同语义的 TS 镜像（触发弹窗预拦截用）。
 * 跨零点窗口的凌晨段按「前一天」的星期归属；配置损坏 = fail-closed。
 */
export function inChangeWindow(cw: ChangeWindow, now: Date): boolean {
  if (!cw.enabled) return true
  const start = hhmmToMinutes(cw.start)
  const end = hhmmToMinutes(cw.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  const allowed = (d: number): boolean =>
    !cw.weekdays || cw.weekdays.length === 0 || cw.weekdays.includes(d)
  if (start <= end) {
    return minutes >= start && minutes < end && allowed(now.getDay())
  }
  if (minutes >= start) return allowed(now.getDay())
  if (minutes < end) return allowed((now.getDay() + 6) % 7)
  return false
}
