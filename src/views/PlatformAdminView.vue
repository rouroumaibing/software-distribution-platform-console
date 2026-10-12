<script setup lang="ts">
// 平台管理（IA v2）：用户与平台权限（平台级 RBAC，C-10 端点）/ 接入管理 / 凭据管理。
// 组件级授权在各组件详情的「权限」Tab —— 权限双轨的平台侧半边。
//
// hub 不存用户表（ACCOUNT-PERMISSION-MODEL §2.2），所以本页**没有用户目录**，
// 也不调 `GET /users`（hub 无该端点）。主体暴露方式按决策文档 §3.5 第 4 条
// 的 (b′)：下拉候选 = 绑定表里去重出的「已绑定主体」，新主体靠**手输** `sub` / 组路径。
import { computed, onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import CredentialsView from '@/views/CredentialsView.vue'
import { permissionApi, type ComponentRole, type PlatformRole, type PlatformRoleBinding } from '@/api/permission'
import { targetApi, type Target } from '@/api/target'
import { credentialApi, type KubeParseResult } from '@/api/credential'
import { auditApi, type AuditLog, type AuditLogFilter } from '@/api/audit'
import { platformApi, type ChangeWindow } from '@/api/platform'
import { agentOpApi, agentOpStatusLabel, agentOpTypeLabel, type AgentOp } from '@/api/agentOp'
import { http } from '@/api/http'
import { toast } from '@/utils/toast'

// ---- §6.3 平台运维聚合（只读） --------------------------------------------
interface RunnerAgg {
  name: string
  status: string
  agentVersion?: string
  lastHeartbeatAt?: string
  online: boolean
  runs30d?: number
  runsTotal?: number
}
const opsRunners = ref<RunnerAgg[]>([])
const opsOnline = ref(0)
const opsHealth = ref('')

async function loadOps() {
  try {
    const [runners, quota, health] = await Promise.all([
      http.get<{ data: { items: RunnerAgg[]; online: number } }>('/ops/runners').then((r) => r.data.data),
      http.get<{ data: { items: Array<{ targetName: string; runs30d: number; runsTotal: number }> } }>('/ops/quota').then((r) => r.data.data).catch(() => ({ items: [] })),
      http.get<{ data: { status: string } }>('/ops/health').then((r) => r.data.data).catch(() => ({ status: 'unknown' })),
    ])
    const q = new Map(quota.items.map((q) => [q.targetName, q]))
    opsRunners.value = runners.items.map((r) => ({ ...r, ...(q.get(r.name) ?? {}) }))
    opsOnline.value = runners.online
    opsHealth.value = health.status
  } catch {
    /* 运维聚合失败不打断接入管理页 */
  }
}

// ---- B4 平台自升级审批流（升级审批 Tab） -----------------------------------
const pendingUpgrades = ref<AgentOp[]>([])
const upgradeLoading = ref(false)
const actingOpId = ref('')

async function loadUpgradeApprovals() {
  upgradeLoading.value = true
  try {
    // 平台级台账按状态过滤：只拉待审批的升级 op（跨全部目标）。
    const p = await agentOpApi.list('pending_approval')
    pendingUpgrades.value = p.items
  } catch {
    /* 无审批权限或端点缺失：留空，不阻断页面 */
  } finally {
    upgradeLoading.value = false
  }
}

async function approveUpgrade(op: AgentOp) {
  actingOpId.value = op.id
  try {
    await agentOpApi.approve(op.id)
    toast.ok('已批准升级，开始派发到目标 Runner')
    await loadUpgradeApprovals()
  } catch (e) {
    toast.err('批准失败：' + failMsg(e))
  } finally {
    actingOpId.value = ''
  }
}

async function rejectUpgrade(op: AgentOp) {
  const reason = window.prompt('驳回理由（可选）：')
  if (reason === null) return // 取消
  actingOpId.value = op.id
  try {
    await agentOpApi.reject(op.id, reason || undefined)
    toast.ok('已驳回升级')
    await loadUpgradeApprovals()
  } catch (e) {
    toast.err('驳回失败：' + failMsg(e))
  } finally {
    actingOpId.value = ''
  }
}

// ---- §5.1 变更窗口（平台设置 Tab） ----------------------------------------
const WEEKDAY_OPTS = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' },
  { value: 0, label: '日' },
] as const
const changeWindow = reactive<ChangeWindow>({ enabled: false, start: '09:00', end: '18:00', weekdays: [] })
const cwSaving = ref(false)

async function loadChangeWindow() {
  try {
    const cw = await platformApi.getChangeWindow()
    changeWindow.enabled = cw.enabled
    changeWindow.start = cw.start || '09:00'
    changeWindow.end = cw.end || '18:00'
    changeWindow.weekdays = cw.weekdays ?? []
  } catch {
    // 旧 hub 无端点 → 保持默认关闭档
  }
}

async function saveChangeWindow() {
  cwSaving.value = true
  try {
    const saved = await platformApi.updateChangeWindow({
      enabled: changeWindow.enabled,
      start: changeWindow.start,
      end: changeWindow.end,
      weekdays: changeWindow.weekdays ?? [],
    })
    Object.assign(changeWindow, saved, { weekdays: saved.weekdays ?? [] })
    toast.ok('变更窗口已保存')
  } finally {
    cwSaving.value = false
  }
}
import {
  COMPONENT_ROLE_ACTION_GROUPS,
  failMsg,
  formatExpiryISO,
  knownSubjects,
  parseActions,
  subjectInputHint,
  subjectLabel,
  validateSubjectInput,
  type SubjectType,
} from '@/utils/permission'

const props = defineProps<{ section: 'permissions' | 'targets' | 'credentials' | 'audit' | 'settings' | 'upgrade-approvals' }>()

const roles = ref<PlatformRole[]>([]) // §7.2 平台角色（C-10，可管理）
const bindings = ref<PlatformRoleBinding[]>([]) // 平台级绑定（C-10，可管理）
const componentRoles = ref<ComponentRole[]>([]) // §7.3 组件角色（B-11，可管理）
const targets = ref<Target[]>([])
const loading = ref(true)

// ---- 审计日志（STATUS #19 消费端）：读取端点 = hub GET /audit-logs ----
const auditRows = ref<AuditLog[]>([])
const auditLoading = ref(false)
// ui-12 §5.4：reason 关键词 / ticket 变更单号筛选（hub 端点 4.4 已支持）。
const auditFilter = reactive<AuditLogFilter>({ actionPrefix: '', subject: '', reason: '', ticket: '', limit: 200 })

async function loadAuditLogs() {
  auditLoading.value = true
  try {
    auditRows.value = await auditApi.list({
      actionPrefix: auditFilter.actionPrefix || undefined,
      subject: auditFilter.subject || undefined,
      reason: auditFilter.reason || undefined,
      ticket: auditFilter.ticket || undefined,
      limit: auditFilter.limit,
    })
  } finally {
    auditLoading.value = false
  }
}

function fmtAuditTime(s: string) {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false })
}

const roleById = (id?: string) => roles.value.find((r) => r.id === id)

async function loadRoles() {
  roles.value = await permissionApi.platformRoles.list()
}
async function loadBindings() {
  bindings.value = await permissionApi.platformBindings.list()
}
async function loadComponentRoles() {
  componentRoles.value = await permissionApi.componentRoles.list()
}

onMounted(async () => {
  try {
    if (props.section === 'permissions') {
      await Promise.all([loadRoles(), loadBindings(), loadComponentRoles()])
    } else if (props.section === 'targets') {
      const c = await targetApi.list({ page: 1, pageSize: 100 })
      targets.value = c.items
      loadOps()
    } else if (props.section === 'audit') {
      await loadAuditLogs()
    } else if (props.section === 'settings') {
      await loadChangeWindow()
    } else if (props.section === 'upgrade-approvals') {
      await loadUpgradeApprovals()
    }
    // section === 'credentials' → <CredentialsView/> 自行加载，这里无需取数
  } finally {
    loading.value = false
  }
})

// ---------------------------------------------------------------------------
// 平台角色（CRUD）
// ---------------------------------------------------------------------------
const roleModal = ref(false)
const roleSaving = ref(false)
const roleEditId = ref<string | null>(null)
const roleForm = reactive({ name: '', description: '', actionsText: '' })

function openCreateRole() {
  roleEditId.value = null
  roleForm.name = ''
  roleForm.description = ''
  roleForm.actionsText = ''
  roleModal.value = true
}
function openEditRole(r: PlatformRole) {
  roleEditId.value = r.id
  roleForm.name = r.name
  roleForm.description = r.description ?? ''
  roleForm.actionsText = (r.actions ?? []).join('\n')
  roleModal.value = true
}
async function saveRole() {
  if (!roleForm.name.trim()) {
    toast.err('请填写角色名')
    return
  }
  roleSaving.value = true
  try {
    const payload = {
      name: roleForm.name.trim(),
      description: roleForm.description.trim(),
      actions: parseActions(roleForm.actionsText),
    }
    if (roleEditId.value) await permissionApi.platformRoles.update(roleEditId.value, payload)
    else await permissionApi.platformRoles.create(payload)
    toast.ok(roleEditId.value ? '已更新角色' : '已创建角色')
    roleModal.value = false
    await loadRoles()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    roleSaving.value = false
  }
}
async function deleteRole(r: PlatformRole) {
  if (r.isSystem) return
  if (!window.confirm(`删除平台角色「${r.name}」？被引用的角色会拒绝删除。`)) return
  try {
    await permissionApi.platformRoles.remove(r.id)
    toast.ok('已删除角色')
    await loadRoles()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

// ---------------------------------------------------------------------------
// 组件角色（§7.3，B-11 自定义角色）：与平台角色同级，写端点同样需平台级 user:manage。
// 与平台角色不同，权限点用「勾选」而非自由文本 —— 组件可授予的动作是固定 vocabulary
// （hub 按字面量校验，拼错即静默 403），勾选能从根本上杜绝手滑。
// ---------------------------------------------------------------------------
const compRoleModal = ref(false)
const compRoleSaving = ref(false)
const compRoleEditId = ref<string | null>(null)
const compRoleForm = reactive<{ name: string; description: string; actions: string[] }>({
  name: '',
  description: '',
  actions: [],
})

function openCreateCompRole() {
  compRoleEditId.value = null
  compRoleForm.name = ''
  compRoleForm.description = ''
  compRoleForm.actions = []
  compRoleModal.value = true
}
function openEditCompRole(r: ComponentRole) {
  compRoleEditId.value = r.id
  compRoleForm.name = r.name
  compRoleForm.description = r.description ?? ''
  compRoleForm.actions = [...(r.actions ?? [])]
  compRoleModal.value = true
}
function toggleCompAction(value: string, checked: boolean) {
  if (checked) {
    if (!compRoleForm.actions.includes(value)) compRoleForm.actions.push(value)
  } else {
    compRoleForm.actions = compRoleForm.actions.filter((a) => a !== value)
  }
}
async function saveCompRole() {
  if (!compRoleForm.name.trim()) {
    toast.err('请填写角色名')
    return
  }
  if (compRoleForm.actions.length === 0) {
    toast.err('请至少勾选一个权限点')
    return
  }
  compRoleSaving.value = true
  try {
    const payload = {
      name: compRoleForm.name.trim(),
      description: compRoleForm.description.trim(),
      actions: [...compRoleForm.actions],
    }
    if (compRoleEditId.value) await permissionApi.componentRoles.update(compRoleEditId.value, payload)
    else await permissionApi.componentRoles.create(payload)
    toast.ok(compRoleEditId.value ? '已更新组件角色' : '已创建组件角色')
    compRoleModal.value = false
    await loadComponentRoles()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    compRoleSaving.value = false
  }
}
async function deleteCompRole(r: ComponentRole) {
  if (r.isSystem) return
  if (!window.confirm(`删除组件角色「${r.name}」？仍被绑定引用的角色会拒绝删除。`)) return
  try {
    await permissionApi.componentRoles.remove(r.id)
    toast.ok('已删除组件角色')
    await loadComponentRoles()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

// ---------------------------------------------------------------------------
// 平台权限绑定（CRUD）
// ---------------------------------------------------------------------------
const bindModal = ref(false)
const bindSaving = ref(false)
const bindForm = reactive({
  subjectType: 'user' as SubjectType,
  subjectValue: '',
  platformRoleId: '',
  expiresAt: '',
})

// 候选 = 已有平台绑定里的主体（去重、按类型过滤）。只是省事的候选，手输不受限。
const subjectOptions = computed(() =>
  knownSubjects(bindings.value).filter((s) => s.subjectType === bindForm.subjectType),
)
const subjectHint = computed(() => subjectInputHint(bindForm.subjectType, bindForm.subjectValue))
// 「已绑定主体」只读清单：这就是「用户与平台权限」页的全部人员可见性。
const boundSubjects = computed(() => knownSubjects(bindings.value))
const roleCountFor = (subjectId: string, subjectType: string) =>
  bindings.value.filter((b) => b.subjectId === subjectId && b.subjectType === subjectType).length

function resetBindForm() {
  bindForm.subjectType = 'user'
  bindForm.subjectValue = ''
  bindForm.platformRoleId = ''
  bindForm.expiresAt = ''
}
function openCreateBinding() {
  resetBindForm()
  bindModal.value = true
}
async function saveBinding() {
  const invalid = validateSubjectInput(bindForm.subjectType, bindForm.subjectValue)
  if (invalid) {
    toast.err(invalid)
    return
  }
  if (!bindForm.platformRoleId) {
    toast.err('请选择平台角色')
    return
  }
  const expiresAt = formatExpiryISO(bindForm.expiresAt)
  const payload = {
    subjectType: bindForm.subjectType,
    subjectId: bindForm.subjectValue.trim(),
    platformRoleId: bindForm.platformRoleId,
    ...(expiresAt ? { expiresAt } : {}),
  }
  bindSaving.value = true
  try {
    await permissionApi.platformBindings.create(payload)
    toast.ok('已添加平台绑定')
    bindModal.value = false
    await loadBindings()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    bindSaving.value = false
  }
}
async function removeBinding(id: string) {
  try {
    await permissionApi.platformBindings.remove(id)
    toast.ok('已解绑')
    await loadBindings()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

// ---------------------------------------------------------------------------
// 注册接入目标（§9.5/§9.7）：k8s 集群（kubeconfig 结构预览）/ 主机两类。
// hub 契约：POST /targets（通用 CRUD，body = name/vendor/region/targetKind）；
// kubeconfig 的权威校验在 hub 侧凭据体系，console 只做 POST /credentials/parse-kubeconfig
// 结构预览，让用户在提交前看到 server/认证方式。
// 成功后展示一次性 enroll-token（POST /targets/:id/enroll-token，24h）——
// 这是 Runner Agent 完成首次回连注册的凭证，关掉弹窗就再也看不到。
// ---------------------------------------------------------------------------
const targetModal = ref(false)
const targetSaving = ref(false)
const targetForm = reactive<{ name: string; vendor: string; region: string; targetKind: 'k8s' | 'host'; kubeconfig: string }>({
  name: '',
  vendor: '',
  region: '',
  targetKind: 'k8s',
  kubeconfig: '',
})
const kubeParse = ref<KubeParseResult | null>(null)
const kubeParseErr = ref('')
const enrollInfo = ref<{ token: string; expiresIn: string } | null>(null)

function openRegisterTarget() {
  targetForm.name = ''
  targetForm.vendor = ''
  targetForm.region = ''
  targetForm.targetKind = 'k8s'
  targetForm.kubeconfig = ''
  kubeParse.value = null
  kubeParseErr.value = ''
  enrollInfo.value = null
  targetModal.value = true
}

async function previewKubeconfig() {
  if (targetForm.targetKind !== 'k8s' || !targetForm.kubeconfig.trim()) return
  kubeParseErr.value = ''
  try {
    kubeParse.value = await credentialApi.parseKubeconfig(targetForm.kubeconfig)
    const errs = kubeParse.value.errors || []
    if (errs.length) kubeParseErr.value = errs.join('；')
  } catch (e) {
    kubeParseErr.value = failMsg(e)
    kubeParse.value = null
  }
}

async function saveTarget() {
  if (!targetForm.name.trim()) {
    toast.err('请填写目标名称')
    return
  }
  if (!targetForm.vendor.trim() || !targetForm.region.trim()) {
    toast.err('请填写厂商与区域')
    return
  }
  targetSaving.value = true
  try {
    const t = await targetApi.create({
      name: targetForm.name.trim(),
      vendor: targetForm.vendor.trim(),
      region: targetForm.region.trim(),
      targetKind: targetForm.targetKind,
    })
    // 注册即申请一次性 enroll token（失败不阻塞：可之后在 Runner 侧重试）。
    try {
      const et = await targetApi.enrollToken(t.id)
      enrollInfo.value = { token: et.enrollToken, expiresIn: et.expiresIn }
    } catch {
      enrollInfo.value = null
    }
    toast.ok('已注册接入目标')
    const c = await targetApi.list({ page: 1, pageSize: 100 })
    targets.value = c.items
    if (!enrollInfo.value) targetModal.value = false
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    targetSaving.value = false
  }
}

function fmtHeartbeat(s?: string) {
  if (!s) return '—'
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000)
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`
  return `${Math.floor(sec / 3600)}h 前`
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">{{ section === 'permissions' ? '用户与平台权限' : section === 'targets' ? '接入管理' : section === 'audit' ? '平台审计日志' : section === 'upgrade-approvals' ? '升级审批' : '凭据管理' }}</h1>
      <div class="sub" v-if="section === 'credentials'">
        凭据注册与加密存储：hub 侧 AES-GCM 信封加密，明文不回流 console（仅创建/修改请求携带）。
      </div>
      <div class="sub" v-else-if="section === 'upgrade-approvals'">
        B4 平台自升级审批流：Runner 升级属高危操作，需平台级 <code>ops:manage</code> 角色审批后才能派发；
        超过 24h 无人审批自动驳回（不静默放行）。
      </div>
      <div class="sub" v-else>
        平台级管理 · 组件级授权在各组件详情的「权限」Tab · 主体按 Keycloak <code>sub</code> /
        组路径标识（hub 不存用户表，无人员目录）
      </div>
    </div>

    <div class="tabs" style="margin-top: 0">
      <router-link class="tab" :class="{ active: section === 'permissions' }" to="/admin/permissions">用户与平台权限</router-link>
      <router-link class="tab" :class="{ active: section === 'targets' }" to="/admin/targets">接入管理</router-link>
      <router-link class="tab" :class="{ active: section === 'credentials' }" to="/admin/credentials">凭据管理</router-link>
      <router-link class="tab" :class="{ active: section === 'audit' }" to="/admin/audit">审计日志</router-link>
      <router-link class="tab" :class="{ active: section === 'settings' }" to="/admin/settings">平台设置</router-link>
      <router-link class="tab" :class="{ active: section === 'upgrade-approvals' }" to="/admin/upgrade-approvals">升级审批</router-link>
    </div>

    <!-- §5.1 变更窗口（平台级特性开关）：开启后仅窗口内可触发新运行。
         前端在触发弹窗预拦截，hub 在 Trigger 入口强校验（409 同形状）。 -->
    <template v-if="section === 'settings'">
      <div class="card" style="max-width: 640px">
        <h2 class="h2" style="margin: 0 0 10px">变更窗口</h2>
        <p class="muted" style="margin-top: 0">
          开启后，<strong>只有窗口内的时段允许触发新运行</strong>（所有来源：手动 / 定时 / Webhook / 事件）。
          触发弹窗会即时预拦截；hub 侧同时强校验，窗口外触发返回 409。
        </p>
        <div class="field" style="margin-bottom: 12px">
          <label class="chk">
            <input v-model="changeWindow.enabled" type="checkbox" />
            启用变更窗口管控
          </label>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 12px">
          <div class="field">
            <label>每日开始</label>
            <input v-model="changeWindow.start" class="input" type="time" />
          </div>
          <div class="field">
            <label>每日结束</label>
            <input v-model="changeWindow.end" class="input" type="time" />
          </div>
        </div>
        <div class="field" style="margin-bottom: 14px">
          <label>允许星期（不选 = 每天）</label>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <label v-for="d in WEEKDAY_OPTS" :key="d.value" class="chk">
              <input v-model="changeWindow.weekdays" type="checkbox" :value="d.value" />
              {{ d.label }}
            </label>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="cwSaving" @click="saveChangeWindow">
          {{ cwSaving ? '保存中…' : '保存变更窗口' }}
        </button>
      </div>
    </template>

    <template v-if="section === 'permissions'">
      <!-- 平台角色 -->
      <div class="toolbar">
        <h2 class="h2" style="margin: 0">平台角色</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl" @click="openCreateRole">＋ 新建角色</button>
      </div>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="roles.length === 0" class="empty">暂无平台角色</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>角色</th>
              <th>权限点</th>
              <th>类型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in roles" :key="r.id">
              <td>
                <b>{{ r.name }}</b>
                <div class="muted" v-if="r.description">{{ r.description }}</div>
              </td>
              <td>
                <span v-for="a in r.actions" :key="a" class="chip" style="margin-right: 6px">{{ a }}</span>
                <span class="muted" v-if="!r.actions || r.actions.length === 0">—</span>
              </td>
              <td>{{ r.isSystem ? '系统内置' : '自定义' }}</td>
              <td class="row-actions">
                <a @click="openEditRole(r)">编辑</a>
                <a v-if="!r.isSystem" style="color: var(--failed-fg)" @click="deleteRole(r)">删除</a>
                <span v-else class="muted">内置</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 组件角色（§7.3，B-11 自定义角色） -->
      <div class="toolbar">
        <h2 class="h2" style="margin: 0">组件角色</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl" @click="openCreateCompRole">＋ 新建组件角色</button>
      </div>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="componentRoles.length === 0" class="empty">暂无组件角色</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>角色</th>
              <th>权限点</th>
              <th>类型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in componentRoles" :key="r.id">
              <td>
                <b>{{ r.name }}</b>
                <div class="muted" v-if="r.description">{{ r.description }}</div>
              </td>
              <td>
                <span v-for="a in r.actions" :key="a" class="chip" style="margin-right: 6px">{{ a }}</span>
                <span class="muted" v-if="!r.actions || r.actions.length === 0">—</span>
              </td>
              <td>{{ r.isSystem ? '系统内置' : '自定义' }}</td>
              <td class="row-actions">
                <a v-if="!r.isSystem" @click="openEditCompRole(r)">编辑</a>
                <a v-if="!r.isSystem" style="color: var(--failed-fg)" @click="deleteCompRole(r)">删除</a>
                <span v-else class="muted">内置</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 平台权限绑定 -->
      <div class="toolbar">
        <h2 class="h2" style="margin: 0">平台权限绑定</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl" @click="openCreateBinding">＋ 添加绑定</button>
      </div>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="bindings.length === 0" class="empty">暂无平台绑定（开启鉴权前任何人都没有平台权限）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>类型</th>
              <th>主体</th>
              <th>平台角色</th>
              <th>过期</th>
              <th>授权时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in bindings" :key="b.id">
              <td><span class="badge">{{ b.subjectType === 'group' ? '组' : '用户' }}</span></td>
              <td class="mono" :title="subjectLabel(b)">{{ subjectLabel(b) }}</td>
              <td><span class="chip">{{ roleById(b.platformRoleId)?.name ?? b.platformRoleId.slice(0, 8) }}</span></td>
              <td class="mono">{{ b.expiresAt ? new Date(b.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久' }}</td>
              <td class="mono">{{ new Date(b.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
              <td><a style="color: var(--failed-fg)" @click="removeBinding(b.id)">解绑</a></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 已绑定主体（只读；这就是全部的「人员可见性」） -->
      <h2 class="h2">已绑定主体</h2>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="boundSubjects.length === 0" class="empty">暂无已绑定主体</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>类型</th>
              <th>主体</th>
              <th>平台角色数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in boundSubjects" :key="s.subjectType + ':' + s.subjectId">
              <td><span class="badge">{{ s.subjectType === 'group' ? '组' : '用户' }}</span></td>
              <td class="mono" :title="s.subjectId">{{ s.subjectId }}</td>
              <td class="mono">{{ roleCountFor(s.subjectId, s.subjectType) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top: 8px">
        hub 不保存用户表（规范 §2.2），因此这里只列**已经拥有绑定**的主体。给新人授权时，
        请在「添加绑定」里直接填入他在 Keycloak 里的 <code>sub</code> —— 不需要他先登录一次。
      </p>
    </template>

    <template v-else-if="section === 'targets'">
      <div class="toolbar">
        <h2 class="h2" style="margin: 0">接入目标</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl" @click="openRegisterTarget">＋ 注册目标</button>
      </div>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="targets.length === 0" class="empty">暂无接入目标。可手动注册，Runner 上线后也会自动注册。</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>厂商</th>
              <th>区域</th>
              <th>状态</th>
              <th>Agent 版本</th>
              <th>最近心跳</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in targets" :key="c.id">
              <td><b>{{ c.name }}</b></td>
              <td><span class="chip">{{ c.targetKind === 'host' ? '主机' : 'K8s' }}</span></td>
              <td>{{ c.vendor || '—' }}</td>
              <td>{{ c.region || '—' }}</td>
              <td>
                <span class="badge" :class="c.status === 'online' ? 'b-succ' : 'b-pend'">
                  <span class="pt"></span>{{ c.status === 'online' ? '在线' : '离线' }}
                </span>
              </td>
              <td class="mono">{{ c.agentVersion || '—' }}</td>
              <td class="mono">{{ fmtHeartbeat(c.lastHeartbeatAt) }}</td>
              <td class="row-actions">
                <router-link :to="`/admin/targets/${c.id}/agent-ops`">操作记录</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- §6.3 平台运维（只读聚合）：健康 + Runner 在线/版本 + 用量 -->
      <div class="toolbar" style="margin-top: 18px">
        <h2 class="h2" style="margin: 0">平台运维</h2>
        <div class="spacer"></div>
        <span class="chip" :class="opsHealth === 'healthy' ? 'chip-ok' : 'chip-warn'">
          平台：{{ opsHealth === 'healthy' ? '健康' : '降级' }}
        </span>
        <span class="chip">Runner 在线 {{ opsOnline }}/{{ opsRunners.length }}</span>
        <button class="btn btn-pearl btn-sm" @click="loadOps">刷新</button>
      </div>
      <div class="card flush">
        <table class="table">
          <thead><tr><th>目标</th><th>状态</th><th>Agent 版本</th><th>心跳</th><th>近 30 天运行</th><th>累计运行</th></tr></thead>
          <tbody>
            <tr v-if="opsRunners.length === 0"><td colspan="6" class="empty">无数据</td></tr>
            <tr v-for="r in opsRunners" :key="r.name">
              <td><b>{{ r.name }}</b></td>
              <td>{{ r.online ? '在线' : '离线' }}</td>
              <td class="mono">{{ r.agentVersion || '—' }}</td>
              <td class="mono">{{ fmtHeartbeat(r.lastHeartbeatAt) }}</td>
              <td>{{ r.runs30d ?? 0 }}</td>
              <td>{{ r.runsTotal ?? 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="section === 'credentials'">
      <CredentialsView />
    </template>

    <!-- 平台审计日志（STATUS #19 消费端）：hub AuditMiddleware 逐条留痕的只读视图。
         权限说明：hub 侧端点要求平台级 user:manage，403 由 http 拦截器统一跳 Forbidden。 -->
    <template v-else-if="section === 'audit'">
      <div class="toolbar" style="margin-top: 0">
        <input
          v-model="auditFilter.actionPrefix"
          class="input"
          style="max-width: 220px"
          type="text"
          placeholder="action 前缀，如 approval."
          @keyup.enter="loadAuditLogs"
        />
        <input
          v-model="auditFilter.subject"
          class="input"
          style="max-width: 220px"
          type="text"
          placeholder="主体（sub 或 /组路径）"
          @keyup.enter="loadAuditLogs"
        />
        <input
          v-model="auditFilter.reason"
          class="input"
          style="max-width: 200px"
          type="text"
          placeholder="原因关键词…"
          @keyup.enter="loadAuditLogs"
        />
        <input
          v-model="auditFilter.ticket"
          class="input"
          style="max-width: 160px"
          type="text"
          placeholder="变更单号…"
          @keyup.enter="loadAuditLogs"
        />
        <button class="btn btn-primary btn-sm" @click="loadAuditLogs">查询</button>
        <div class="spacer"></div>
        <span class="muted">共 {{ auditRows.length }} 条（最新优先，默认近 200 条）</span>
      </div>
      <div class="card flush" style="margin-top: 14px">
        <div v-if="auditLoading" class="loading">加载中…</div>
        <div v-else-if="auditRows.length === 0" class="empty">暂无审计记录（变更发生后这里会有留痕）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>主体</th>
              <th>动作</th>
              <th>资源</th>
              <th>结果</th>
              <th>来源 IP</th>
              <th>原因 / 单号</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in auditRows" :key="a.id">
              <td class="mono">{{ fmtAuditTime(a.timestamp) }}</td>
              <td>
                <span class="chip">{{ a.subjectType === 'group' ? '组' : '用户' }}</span>
                <span class="mono">{{ a.subject }}</span>
              </td>
              <td class="mono">{{ a.action }}</td>
              <td>
                <template v-if="a.resourceType">
                  <span class="mono">{{ a.resourceType }}</span>
                  <span class="mono muted" v-if="a.resourceId"> / {{ a.resourceId.slice(0, 8) }}</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span class="badge" :class="a.result === 'success' ? 'b-succ' : 'b-fail'">
                  <span class="pt"></span>{{ a.result === 'success' ? `成功 ${a.statusCode}` : `失败 ${a.statusCode}` }}
                </span>
              </td>
              <td class="mono">{{ a.sourceIP || '—' }}</td>
              <td class="muted" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                <template v-if="a.reason || a.ticket">
                  <span v-if="a.reason">{{ a.reason }}</span>
                  <span v-if="a.ticket" class="mono" style="display: block">{{ a.ticket }}</span>
                </template>
                <span v-else>—</span>
              </td>
              <td class="muted" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                {{ a.detail || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- B4 平台自升级审批流（升级审批 Tab）：列出所有待审批的升级 op，审批/驳回。 -->
    <template v-else-if="section === 'upgrade-approvals'">
      <div class="toolbar" style="margin-top: 0">
        <h2 class="h2" style="margin: 0">待审批的 Runner 升级</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl btn-sm" :disabled="upgradeLoading" @click="loadUpgradeApprovals">刷新</button>
      </div>
      <div class="card flush" style="margin-top: 14px">
        <div v-if="upgradeLoading" class="loading">加载中…</div>
        <div v-else-if="pendingUpgrades.length === 0" class="empty">暂无待审批的升级（所有升级已审批 / 驳回）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>目标</th>
              <th>类型</th>
              <th>目标版本</th>
              <th>状态</th>
              <th>申请时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="op in pendingUpgrades" :key="op.id">
              <td><b>{{ op.targetId.slice(0, 8) }}</b></td>
              <td><span class="chip">{{ agentOpTypeLabel(op.opType) }}</span></td>
              <td class="mono">{{ op.detail || '—' }}</td>
              <td><span class="badge" :class="op.status === 'pending_approval' ? 'b-pend' : ''">{{ agentOpStatusLabel(op.status) }}</span></td>
              <td class="mono">{{ new Date(op.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
              <td class="row-actions">
                <a @click="approveUpgrade(op)" :class="{ disabled: actingOpId === op.id }">批准</a>
                <a style="color: var(--failed-fg)" @click="rejectUpgrade(op)" :class="{ disabled: actingOpId === op.id }">驳回</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top: 8px">
        批准即把升级 op 置为可派发并下发给目标 Runner；驳回直接关闭且不派发。超过 24 小时无人处理的待审批项会被定时任务自动驳回。
      </p>
    </template>

    <!-- 平台角色 编辑/新建 -->
    <Modal :open="roleModal" :title="roleEditId ? '编辑平台角色' : '新建平台角色'" @close="roleModal = false">
      <div class="field">
        <label>角色名</label>
        <input v-model="roleForm.name" class="input" type="text" placeholder="如 sdp-admin" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="roleForm.description" class="input" type="text" placeholder="可选" />
      </div>
      <div class="field">
        <label>权限点（每行 / 逗号分隔）</label>
        <textarea v-model="roleForm.actionsText" class="input" rows="4" placeholder="platform:role:create&#10;platform:role:bind"></textarea>
        <p class="hint">权限点由 hub 在路由注册时以字面量校验（见 ACCOUNT-PERMISSION-MODEL §5）。</p>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="roleModal = false">取消</button>
        <button class="btn btn-primary" :disabled="roleSaving" @click="saveRole">
          {{ roleSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <!-- 组件角色 编辑/新建 -->
    <Modal :open="compRoleModal" :title="compRoleEditId ? '编辑组件角色' : '新建组件角色'" @close="compRoleModal = false">
      <div class="field">
        <label>角色名</label>
        <input v-model="compRoleForm.name" class="input" type="text" placeholder="如 team-deployer" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="compRoleForm.description" class="input" type="text" placeholder="可选" />
      </div>
      <div class="field">
        <label>权限点（勾选；与 hub 侧 vocabulary 逐字对齐，拼错即静默 403）</label>
        <div class="action-groups">
          <div v-for="g in COMPONENT_ROLE_ACTION_GROUPS" :key="g.label" class="action-group">
            <div class="action-group-title">{{ g.label }}</div>
            <label v-for="a in g.actions" :key="a.value" class="action-check">
              <input
                type="checkbox"
                :value="a.value"
                :checked="compRoleForm.actions.includes(a.value)"
                @change="toggleCompAction(a.value, ($event.target as HTMLInputElement).checked)"
              />
              <span><code>{{ a.value }}</code><span class="muted"> · {{ a.label }}</span></span>
            </label>
          </div>
        </div>
        <p class="hint">角色至少授予一个权限点；授予空的角色后端会拒绝（它谁也不授权，错误只会在 403 时暴露）。</p>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="compRoleModal = false">取消</button>
        <button class="btn btn-primary" :disabled="compRoleSaving" @click="saveCompRole">
          {{ compRoleSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <!-- 平台绑定 添加 -->
    <Modal :open="bindModal" title="添加平台绑定" @close="bindModal = false">
      <div class="field">
        <label>主体类型</label>
        <div class="seg">
          <label :class="{ active: bindForm.subjectType === 'user' }">
            <input type="radio" value="user" v-model="bindForm.subjectType" /> 用户
          </label>
          <label :class="{ active: bindForm.subjectType === 'group' }">
            <input type="radio" value="group" v-model="bindForm.subjectType" /> 用户组
          </label>
        </div>
      </div>

      <div class="field" v-if="bindForm.subjectType === 'user'">
        <label>用户 sub</label>
        <input
          v-model="bindForm.subjectValue"
          class="input"
          type="text"
          list="platform-subject-options"
          placeholder="Keycloak 用户详情里的 sub（uuid），不是用户名"
        />
        <datalist id="platform-subject-options">
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId" />
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else>下拉候选是已绑定过的主体；新主体直接粘贴 <code>sub</code> 即可。</p>
      </div>
      <div class="field" v-else>
        <label>用户组路径</label>
        <input
          v-model="bindForm.subjectValue"
          class="input"
          type="text"
          list="platform-subject-options"
          placeholder="带前导斜杠，如 /sdp-admin"
        />
        <datalist id="platform-subject-options">
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId" />
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else>组主体须带前导斜杠（本 realm groups mapper 为 full.path）。</p>
      </div>

      <div class="field">
        <label>平台角色</label>
        <select v-model="bindForm.platformRoleId" class="select">
          <option value="">选择平台角色</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">
            {{ r.name }}{{ r.isSystem ? '（内置）' : '（自定义）' }}
          </option>
        </select>
      </div>

      <div class="field">
        <label>过期时间（可选）</label>
        <input v-model="bindForm.expiresAt" class="input" type="datetime-local" />
        <p class="hint">留空 = 永久授权。</p>
      </div>

      <template #foot>
        <button class="btn btn-pearl" @click="bindModal = false">取消</button>
        <button class="btn btn-primary" :disabled="bindSaving" @click="saveBinding">
          {{ bindSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <!-- 注册接入目标 -->
    <Modal :open="targetModal" title="注册接入目标" @close="targetModal = false">
      <template v-if="!enrollInfo">
        <div class="field">
          <label>目标类型</label>
          <div class="seg">
            <label :class="{ active: targetForm.targetKind === 'k8s' }">
              <input type="radio" value="k8s" v-model="targetForm.targetKind" /> Kubernetes 集群
            </label>
            <label :class="{ active: targetForm.targetKind === 'host' }">
              <input type="radio" value="host" v-model="targetForm.targetKind" /> 主机
            </label>
          </div>
        </div>
        <div class="field">
          <label>名称</label>
          <input v-model="targetForm.name" class="input" type="text" placeholder="如 tx-staging-bj（唯一）" />
        </div>
        <div style="display: flex; gap: 10px">
          <div class="field" style="flex: 1">
            <label>厂商</label>
            <input v-model="targetForm.vendor" class="input" type="text" placeholder="如 tencent" />
          </div>
          <div class="field" style="flex: 1">
            <label>区域</label>
            <input v-model="targetForm.region" class="input" type="text" placeholder="如 ap-beijing" />
          </div>
        </div>
        <div class="field" v-if="targetForm.targetKind === 'k8s'">
          <label>kubeconfig（仅预检，不随目标保存）</label>
          <textarea v-model="targetForm.kubeconfig" class="input" rows="5" placeholder="粘贴 kubeconfig 全文，点击「预检解析」查看结构"></textarea>
          <button class="btn btn-pearl btn-sm" type="button" :disabled="!targetForm.kubeconfig.trim()" @click="previewKubeconfig">预检解析</button>
          <p class="hint">
            预检只做结构解析（hub 无 client-go，权威校验在连接时进行）。kubeconfig 本体不存进目标 ——
            请在「凭据管理」创建 kubeconfig 类型凭据并按作用域关联。
          </p>
          <div v-if="kubeParse" class="kube-parse">
            <div><span>Server</span><code>{{ kubeParse.server || '—' }}</code></div>
            <div><span>认证方式</span><code>{{ kubeParse.authMethod }}</code></div>
            <div><span>当前上下文</span><code>{{ kubeParse.currentContext || '—' }}</code></div>
            <div><span>默认命名空间</span><code>{{ kubeParse.defaultNamespace || '—' }}</code></div>
          </div>
          <p v-if="kubeParseErr" class="parse-err">{{ kubeParseErr }}</p>
        </div>
      </template>

      <!-- 注册成功：一次性 enroll token 只展示这一次 -->
      <template v-else>
        <div class="enroll-ok">
          <b>✓ 目标已注册</b>
          <p>在目标机器上安装 Runner Agent 时使用下面的一次性注册令牌（{{ enrollInfo.expiresIn }} 内有效，仅可使用一次）：</p>
          <pre class="enroll-token mono">{{ enrollInfo.token }}</pre>
          <p class="hint">关闭本弹窗后令牌不再展示；如遗失，可在 Runner 接入流程中重新申请（旧令牌随即作废）。</p>
        </div>
      </template>

      <template #foot>
        <template v-if="!enrollInfo">
          <button class="btn btn-pearl" @click="targetModal = false">取消</button>
          <button class="btn btn-primary" :disabled="targetSaving" @click="saveTarget">
            {{ targetSaving ? '注册中…' : '注册' }}
          </button>
        </template>
        <button v-else class="btn btn-primary" @click="targetModal = false">完成</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
/* 表单相关类与 PermissionsTab 同源（tokens.css 未提供全局表单类，故在此 scoped 定义） */
.tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.tab {
  padding: 7px 14px; border-radius: 9px; font-size: 13px; font-weight: 600;
  color: var(--text-sub); cursor: pointer; border: 1px solid transparent;
}
.tab:hover { background: var(--surface-2); color: var(--text); }
.tab.active { background: var(--accent-soft); color: var(--accent); }
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-sub);
}
.input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  font-size: 13px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
}
.select {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  font-size: 13px;
  background: var(--surface);
  color: var(--text);
}
.field .hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-sub);
}
.seg {
  display: flex;
  gap: 8px;
}
.seg label {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.seg label.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.muted {
  color: var(--text-sub);
  font-size: 12px;
}
.chk {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; cursor: pointer; white-space: nowrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.toolbar .spacer { flex: 1; }
.h2 { font-size: 15px; font-weight: 700; }
.kube-parse {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 13px;
}
.kube-parse > div {
  display: flex; justify-content: space-between; padding: 2px 0;
}
.kube-parse code { font-size: 12px; word-break: break-all; }
.parse-err { color: var(--failed-fg); font-size: 12px; margin: 6px 0 0; }
.enroll-ok { font-size: 13px; line-height: 1.6; }
.enroll-ok > b { color: var(--succeeded-fg); }
.enroll-token {
  margin: 8px 0; padding: 10px 12px; background: var(--term-bg); color: var(--term-fg);
  border-radius: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-all;
}
.row-actions {
  white-space: nowrap;
}
.row-actions a {
  margin-right: 12px;
  color: var(--accent);
  cursor: pointer;
}
.action-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.action-group {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 10px 12px;
}
.action-group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-sub);
  margin-bottom: 6px;
}
.action-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 3px 0;
  cursor: pointer;
}
.action-check code {
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 0 5px;
  font-size: 12px;
}
</style>
