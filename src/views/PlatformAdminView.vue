<script setup lang="ts">
// 平台管理（IA v2）：用户与平台权限（M1 用户/组管理 + 平台级 RBAC，C-10 端点）/
// 接入管理 / 凭据管理。组件级授权在各组件详情的「权限」Tab —— 权限双轨的平台侧半边。
//
// hub 不存用户表（ACCOUNT-PERMISSION-MODEL §2.2）：用户/组目录经 hub 代理
// Keycloak Admin REST（directoryApi，N-34），M1 管理区与授权表单候选均来自目录；
// 目录不可用（KC 未配置）时整块隐藏、表单退化「已绑定主体 + 手输 sub / 组路径」。
import { computed, onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import CredentialsView from '@/views/CredentialsView.vue'
import {
  directoryApi,
  permissionApi,
  type ComponentRole,
  type KCGroup,
  type KCUser,
  type PlatformRole,
  type PlatformRoleBinding,
} from '@/api/permission'
import { targetApi, type Target, type JoinBundle } from '@/api/target'
import { buildJoinCommand, copyText } from '@/utils/runnerInstall'
import { credentialApi, type KubeParseResult } from '@/api/credential'
import { auditApi, type AuditLog, type AuditLogFilter } from '@/api/audit'
import { platformApi, type ChangeWindow } from '@/api/platform'
import { agentOpApi, agentOpStatusLabel, agentOpTypeLabel, type AgentOp } from '@/api/agentOp'
import { http } from '@/api/http'
import { authApi, type IdentityProvider } from '@/api/auth'
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

const props = defineProps<{ section: 'permissions' | 'targets' | 'credentials' | 'audit' | 'settings' | 'upgrade-approvals' | 'auth' }>()

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
      await Promise.all([loadRoles(), loadBindings(), loadComponentRoles(), loadDirectory()])
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
    } else if (props.section === 'auth') {
      await loadAuthSettings()
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

// ---- 用户/组目录（N-34，经 hub 代理 Keycloak Admin REST）--------------------
// 授权表单的候选来源：用户 sub（= KC user id）/ 组路径。hub 侧 KC 未配置或
// 代理不可用时目录为空，表单退化为「已绑定主体 + 手输」（validateSubjectInput
// 阻塞性校验不变）。
const dirUsers = ref<KCUser[]>([])
const dirGroups = ref<KCGroup[]>([])
// 目录可用性：KC 未配置时代理端点不存在（404）。M1 用户/组管理区整块隐藏，
// 授权表单退化手输；目录存在但为空（KC 有 realm 无用户）仍展示空表。
const dirAvailable = ref(false)

async function loadDirectory() {
  try {
    const [users, groups] = await Promise.all([directoryApi.users.list(), directoryApi.groups.list()])
    dirUsers.value = users
    dirGroups.value = groups
    dirAvailable.value = true
  } catch {
    // 目录代理 404 / 403：静默退化，手输兜底（M2 语义，不弹错）。
  }
}

// ---------------------------------------------------------------------------
// M1 用户与组管理（ui-05 §7.14 M1）：经 hub 代理 Keycloak Admin REST 的账号
// 生命周期。临时口令（建用户 / 重置密码）由 hub 生成、**响应只返回一次**，
// requiredActions=[UPDATE_PASSWORD] 首登强制改密 —— 前端不缓存、不二次展示。
// `/org:<slug>` 组织载体组由 orgsvc 管理，代理只读（hub handler 403 兜底）。
// ---------------------------------------------------------------------------
const userModal = ref(false)
const userSaving = ref(false)
const userForm = reactive({ username: '', email: '' })
// 一次性口令展示：关掉就再也看不到（与 enroll-token 同语义）。
const pwShow = ref<{ title: string; username: string; password: string } | null>(null)

function openCreateUser() {
  userForm.username = ''
  userForm.email = ''
  userModal.value = true
}

async function saveUser() {
  if (!userForm.username.trim()) {
    toast.err('请填写用户名')
    return
  }
  userSaving.value = true
  try {
    const created = await directoryApi.users.create({
      username: userForm.username.trim(),
      email: userForm.email.trim() || undefined,
    })
    userModal.value = false
    pwShow.value = {
      title: '用户已创建',
      username: created?.username ?? userForm.username.trim(),
      password: created?.temporaryPassword ?? '',
    }
    await loadDirectory()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    userSaving.value = false
  }
}

async function resetPassword(u: KCUser) {
  if (!window.confirm(`为用户「${u.username}」重置密码？将生成新的临时口令，旧口令立即失效。`)) return
  try {
    const r = await directoryApi.users.resetPassword(u.id)
    pwShow.value = { title: '密码已重置', username: u.username, password: r?.password ?? '' }
  } catch (e) {
    toast.err(failMsg(e))
  }
}

async function toggleUser(u: KCUser) {
  const verb = u.enabled ? '停用' : '启用'
  if (!window.confirm(`${verb}用户「${u.username}」？`)) return
  try {
    await directoryApi.users.update(u.id, { enabled: !u.enabled })
    toast.ok(`已${verb}`)
    await loadDirectory()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

const groupModal = ref(false)
const groupSaving = ref(false)
const groupForm = reactive({ name: '' })

function openCreateGroup() {
  groupForm.name = ''
  groupModal.value = true
}

// 与 hub validateRBACGroupName 对齐：名非空、不含 `/`、不得撞组织载体前缀。
function validateGroupName(name: string): string | null {
  if (!name.trim()) return '请填写组名'
  if (name.includes('/')) return '组名不能包含 /（不支持嵌套组）'
  if (name === 'org' || name.startsWith('org:')) return 'org: 前缀是组织载体组保留名（§2.3）'
  return null
}

async function saveGroup() {
  const invalid = validateGroupName(groupForm.name)
  if (invalid) {
    toast.err(invalid)
    return
  }
  groupSaving.value = true
  try {
    await directoryApi.groups.create(groupForm.name.trim())
    toast.ok('已创建用户组')
    groupModal.value = false
    await loadDirectory()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    groupSaving.value = false
  }
}

// 成员管理弹窗：一个组一个弹窗，成员 = 目录用户子集。
const membersModal = ref(false)
const membersLoading = ref(false)
const membersGroup = ref<KCGroup | null>(null)
const members = ref<KCUser[]>([])
const memberToAdd = ref('')

async function openMembers(g: KCGroup) {
  membersGroup.value = g
  memberToAdd.value = ''
  membersModal.value = true
  membersLoading.value = true
  try {
    members.value = await directoryApi.groups.listMembers(g.id)
  } catch (e) {
    toast.err(failMsg(e))
    members.value = []
  } finally {
    membersLoading.value = false
  }
}

async function addMember() {
  const g = membersGroup.value
  if (!g || !memberToAdd.value) {
    toast.err('请选择要加入的用户')
    return
  }
  try {
    await directoryApi.groups.addMember(g.id, memberToAdd.value)
    await openMembers(g)
    await loadDirectory()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

async function removeMember(u: KCUser) {
  const g = membersGroup.value
  if (!g) return
  if (!window.confirm(`把「${u.username}」移出「${g.name}」？`)) return
  try {
    await directoryApi.groups.removeMember(g.id, u.id)
    await openMembers(g)
  } catch (e) {
    toast.err(failMsg(e))
  }
}

async function copyPw() {
  if (pwShow.value && (await copyText(pwShow.value.password))) toast.ok('已复制到剪贴板')
}

// 候选 = 目录 ∪ 已绑定主体（去重）。user 候选展示 username（值仍是 sub）。
const subjectOptions = computed(() => {
  const known = knownSubjects(bindings.value).filter((s) => s.subjectType === bindForm.subjectType)
  const merged = new Map<string, string>()
  if (bindForm.subjectType === 'user') {
    for (const u of dirUsers.value) merged.set(u.id, u.username)
  } else {
    for (const g of dirGroups.value) merged.set(g.path, g.path)
  }
  for (const s of known) if (!merged.has(s.subjectId)) merged.set(s.subjectId, s.subjectId)
  return [...merged].map(([subjectId, label]) => ({
    subjectType: bindForm.subjectType,
    subjectId,
    label,
  }))
})
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

// ---------------------------------------------------------------------------
// Runner 安装命令（ADR-0002）：行内「安装命令」→ POST /targets/:id/join-bundle
// 取对接信息（URL / CA / 指纹 / per-target enrollToken），渲染成目标机自举脚本。
// 501（hub 未配置 publicUrl / TLS CA）时给明确提示，不出空白弹窗。
// ---------------------------------------------------------------------------
const joinModal = ref(false)
const joinLoading = ref(false)
const joinBundle = ref<JoinBundle | null>(null)
const joinErr = ref('')
const joinCopied = ref('')

const joinCmd = computed(() => (joinBundle.value ? buildJoinCommand(joinBundle.value) : null))
const joinFullScript = computed(() =>
  joinCmd.value ? [joinCmd.value.caScript, '', joinCmd.value.envFile].join('\n') : '',
)

async function openJoinBundle(c: Target) {
  joinBundle.value = null
  joinErr.value = ''
  joinCopied.value = ''
  joinModal.value = true
  joinLoading.value = true
  try {
    joinBundle.value = await targetApi.joinBundle(c.id)
  } catch (e) {
    const st = (e as { response?: { status?: number } })?.response?.status
    joinErr.value =
      st === 501
        ? 'hub 未配置对外地址（publicUrl）或 TLS CA，无法生成安装命令（ADR-0002）'
        : failMsg(e)
  } finally {
    joinLoading.value = false
  }
}

async function copyJoin(part: 'script' | 'env') {
  const text = part === 'script' ? joinFullScript.value : (joinCmd.value?.envFile ?? '')
  if (!text) return
  if (await copyText(text)) joinCopied.value = part
  else toast.err('复制失败，请手动选择文本复制')
}

// ---------------------------------------------------------------------------
// 认证设置（AUTH-ARCHITECTURE §2 / §5）：协议层登录模式 + 身份提供商目录。
// 两者都经 realmsettings 端点（hub 代理 Keycloak + DB 持久化 login 模式），
// 需平台级 user:manage（与 platformGroup 守卫同口径）。KC 未配置时端点缺失，
// loadAuthSettings 静默留空，不阻断页面。
// ---------------------------------------------------------------------------
const authLoginMode = ref<'default' | 'keycloak'>('default')
const authModeSaving = ref(false)
const authIdpTypes = ref<string[]>([])
const authIdps = ref<IdentityProvider[]>([])

async function loadAuthSettings() {
  try {
    const [cfg, types, idps] = await Promise.all([
      authApi.authConfig(),
      authApi.listIDPTypes(),
      authApi.listIDP(),
    ])
    authLoginMode.value = cfg.login
    authIdpTypes.value = types.types
    authIdps.value = idps.identityProviders ?? []
  } catch {
    // 端点缺失（KC 未配置）→ 留空，不阻断页面。
  }
}

async function saveLoginMode() {
  authModeSaving.value = true
  try {
    const saved = await authApi.setLoginMode(authLoginMode.value)
    authLoginMode.value = saved.login
    toast.ok(saved.login === 'keycloak' ? '已切换为单点登录（Keycloak）' : '已切换为自研账号登录')
    await loadAuthSettings()
  } catch (e) {
    const st = (e as { response?: { status?: number } })?.response?.status
    toast.err(st === 409 ? '已有启用的身份提供商，无法切回自研账号登录（SSO 用户会失联）' : failMsg(e))
  } finally {
    authModeSaving.value = false
  }
}

// ---- 身份提供商 CRUD ----
const idpModal = ref(false)
const idpSaving = ref(false)
const idpEditAlias = ref<string | null>(null)
const idpForm = reactive<{ alias: string; displayName: string; providerId: string; enabled: boolean; trustEmail: boolean; configText: string }>({
  alias: '',
  displayName: '',
  providerId: '',
  enabled: true,
  trustEmail: false,
  configText: '',
})

// 配置以 `key=value` 行编辑（忽略空行 / 无 `=` 行），提交时转 Record<string,string>。
function parseIdpConfig(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
function configToText(cfg?: Record<string, string>): string {
  if (!cfg) return ''
  return Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join('\n')
}

function openCreateIdp() {
  idpEditAlias.value = null
  idpForm.alias = ''
  idpForm.displayName = ''
  idpForm.providerId = authIdpTypes.value[0] ?? 'oidc'
  idpForm.enabled = true
  idpForm.trustEmail = false
  idpForm.configText = ''
  idpModal.value = true
}
function openEditIdp(idp: IdentityProvider) {
  idpEditAlias.value = idp.alias
  idpForm.alias = idp.alias
  idpForm.displayName = idp.displayName ?? ''
  idpForm.providerId = idp.providerId
  idpForm.enabled = idp.enabled
  idpForm.trustEmail = idp.trustEmail ?? false
  idpForm.configText = configToText(idp.config)
  idpModal.value = true
}
async function saveIdp() {
  if (!idpForm.alias.trim()) {
    toast.err('请填写别名（alias）')
    return
  }
  if (!idpForm.providerId) {
    toast.err('请选择提供商类型')
    return
  }
  idpSaving.value = true
  try {
    const payload: IdentityProvider = {
      alias: idpForm.alias.trim(),
      displayName: idpForm.displayName.trim(),
      providerId: idpForm.providerId,
      enabled: idpForm.enabled,
      trustEmail: idpForm.trustEmail,
      config: parseIdpConfig(idpForm.configText),
    }
    if (idpEditAlias.value) await authApi.updateIDP(idpEditAlias.value, payload)
    else await authApi.createIDP(payload)
    toast.ok(idpEditAlias.value ? '已更新身份提供商' : '已创建身份提供商')
    idpModal.value = false
    await loadAuthSettings()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    idpSaving.value = false
  }
}
async function deleteIdp(idp: IdentityProvider) {
  if (!window.confirm(`删除身份提供商「${idp.alias}」？已通过该 IdP 登录的用户将无法通过此入口登录。`)) return
  try {
    await authApi.deleteIDP(idp.alias)
    toast.ok('已删除身份提供商')
    await loadAuthSettings()
  } catch (e) {
    toast.err(failMsg(e))
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1 class="title">{{ section === 'permissions' ? '用户与平台权限' : section === 'targets' ? '接入管理' : section === 'audit' ? '平台审计日志' : section === 'upgrade-approvals' ? '升级审批' : section === 'auth' ? '认证设置' : '凭据管理' }}</h1>
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
      <router-link class="tab" :class="{ active: section === 'auth' }" to="/admin/auth">认证设置</router-link>
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
      <!-- M1 用户（hub 代理 Keycloak Admin REST；KC 未配置时整块隐藏） -->
      <template v-if="dirAvailable">
        <div class="toolbar">
          <h2 class="h2" style="margin: 0">用户</h2>
          <div class="spacer"></div>
          <button class="btn btn-pearl" @click="openCreateUser">＋ 新建用户</button>
        </div>
        <div class="card flush">
          <div v-if="dirUsers.length === 0" class="empty">目录中没有用户</div>
          <table v-else class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>邮箱</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in dirUsers" :key="u.id">
                <td class="mono" :title="u.id">{{ u.username }}</td>
                <td>{{ u.email || '—' }}</td>
                <td>
                  <span class="badge" :style="u.enabled ? '' : 'background: var(--failed-fg)'">{{ u.enabled ? '启用' : '停用' }}</span>
                  <span v-if="(u.requiredActions ?? []).includes('UPDATE_PASSWORD')" class="chip" style="margin-left: 6px">待改密</span>
                </td>
                <td class="row-actions">
                  <a @click="resetPassword(u)">重置密码</a>
                  <a @click="toggleUser(u)">{{ u.enabled ? '停用' : '启用' }}</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- M1 用户组（/org:* 载体组由系统管理，代理只读） -->
        <div class="toolbar">
          <h2 class="h2" style="margin: 0">用户组</h2>
          <div class="spacer"></div>
          <button class="btn btn-pearl" @click="openCreateGroup">＋ 新建用户组</button>
        </div>
        <div class="card flush">
          <div v-if="dirGroups.length === 0" class="empty">目录中没有用户组</div>
          <table v-else class="table">
            <thead>
              <tr>
                <th>组名</th>
                <th>路径</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in dirGroups" :key="g.id">
                <td>{{ g.name }}</td>
                <td class="mono">{{ g.path }}</td>
                <td class="row-actions">
                  <a @click="openMembers(g)">成员</a>
                  <span v-if="g.path.startsWith('/org:')" class="muted" title="组织载体组由系统自动管理（§2.3），不可在此修改">系统管理</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

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
        hub 不保存用户表（规范 §2.2）：用户与组来自 Keycloak 目录（经 hub 代理），
        绑定主体 = 用户 <code>sub</code> / 组路径。目录不可用时在「添加绑定」里手输即可——
        不需要对方先登录一次。
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
                <a href="javascript:void(0)" @click="openJoinBundle(c)">安装命令</a>
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

    <!-- AUTH-ARCHITECTURE §2 / §5：协议层登录模式（default/keycloak）+ 身份提供商目录 -->
    <template v-else-if="section === 'auth'">
      <div class="card" style="max-width: 720px">
        <h2 class="h2" style="margin: 0 0 10px">登录模式</h2>
        <p class="muted" style="margin-top: 0">
          协议层登录入口：<strong>自研账号登录</strong>（default）= 平台自持用户名/密码表单，无 SSO；
          <strong>单点登录</strong>（keycloak）= 跳转 Keycloak 走 OIDC，带企业 SSO。两者互斥；
          身份存储层恒为 Keycloak（用户目录不迁移）。
        </p>
        <div class="field" style="margin-bottom: 12px">
          <div class="seg">
            <label :class="{ active: authLoginMode === 'default' }">
              <input type="radio" value="default" v-model="authLoginMode" /> 自研账号登录
            </label>
            <label :class="{ active: authLoginMode === 'keycloak' }">
              <input type="radio" value="keycloak" v-model="authLoginMode" /> 单点登录（Keycloak）
            </label>
          </div>
        </div>
        <p class="muted" v-if="authLoginMode === 'default'">
          切回自研账号前需先停用全部身份提供商，否则已通过 SSO 登录的用户会失联。
        </p>
        <button class="btn btn-primary" :disabled="authModeSaving" @click="saveLoginMode">
          {{ authModeSaving ? '保存中…' : '保存登录模式' }}
        </button>
      </div>

      <!-- 身份提供商目录 -->
      <div class="toolbar" style="margin-top: 22px">
        <h2 class="h2" style="margin: 0">身份提供商（SSO）</h2>
        <div class="spacer"></div>
        <button class="btn btn-pearl" @click="openCreateIdp">＋ 新建身份提供商</button>
      </div>
      <div class="card flush">
        <div v-if="authIdps.length === 0" class="empty">暂无身份提供商（未配置 SSO）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>别名</th>
              <th>显示名</th>
              <th>类型</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="idp in authIdps" :key="idp.alias">
              <td class="mono">{{ idp.alias }}</td>
              <td>{{ idp.displayName || '—' }}</td>
              <td><span class="chip">{{ idp.providerId }}</span></td>
              <td>
                <span class="badge" :class="idp.enabled ? 'b-succ' : 'b-pend'">
                  <span class="pt"></span>{{ idp.enabled ? '启用' : '停用' }}
                </span>
              </td>
              <td class="row-actions">
                <a @click="openEditIdp(idp)">编辑</a>
                <a style="color: var(--failed-fg)" @click="deleteIdp(idp)">删除</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 身份提供商 编辑/新建 -->
    <Modal :open="idpModal" :title="idpEditAlias ? '编辑身份提供商' : '新建身份提供商'" :width="640" @close="idpModal = false">
      <div class="field">
        <label>别名（alias）</label>
        <input v-model="idpForm.alias" class="input" type="text" placeholder="如 oidc-corp / saml-adfs" :disabled="!!idpEditAlias" />
        <p class="hint">创建后不可修改；用于登录回调与 KC realm 内唯一标识。</p>
      </div>
      <div class="field">
        <label>显示名</label>
        <input v-model="idpForm.displayName" class="input" type="text" placeholder="可选，如 企业微信 / 微软 AD" />
      </div>
      <div class="field">
        <label>提供商类型</label>
        <select v-model="idpForm.providerId" class="select">
          <option v-for="t in authIdpTypes" :key="t" :value="t">{{ t }}</option>
        </select>
        <p class="hint" v-if="authIdpTypes.length === 0">未取到 KC 支持的提供商类型列表，可手填常见值（oidc / saml / cas）。</p>
      </div>
      <div class="field">
        <label class="chk"><input type="checkbox" v-model="idpForm.enabled" /> 启用</label>
        <label class="chk"><input type="checkbox" v-model="idpForm.trustEmail" /> 信任该 IdP 的邮箱（Trust Email）</label>
      </div>
      <div class="field">
        <label>配置（每行 <code>key=value</code>）</label>
        <textarea v-model="idpForm.configText" class="input" rows="7" placeholder="clientId=xxx&#10;clientSecret=yyy&#10;baseUrl=https://idp.example.com"></textarea>
        <p class="hint">透传 Keycloak 的 IdP config（oidc/saml/cas 各自的字段各异）；hub 不重解释，原样回写 KC。</p>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="idpModal = false">取消</button>
        <button class="btn btn-primary" :disabled="idpSaving" @click="saveIdp">
          {{ idpSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <!-- M1 新建用户 -->
    <Modal :open="userModal" title="新建用户" @close="userModal = false">
      <div class="field">
        <label>用户名</label>
        <input v-model="userForm.username" class="input" type="text" placeholder="如 zhang.san" />
      </div>
      <div class="field">
        <label>邮箱</label>
        <input v-model="userForm.email" class="input" type="email" placeholder="可选" />
      </div>
      <p class="hint">创建成功后展示一次性临时口令，首登强制修改（UPDATE_PASSWORD）；口令只显示这一次。</p>
      <template #foot>
        <button class="btn btn-pearl" @click="userModal = false">取消</button>
        <button class="btn btn-primary" :disabled="userSaving" @click="saveUser">
          {{ userSaving ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- M1 一次性口令展示（关闭即失效可见性；口令本身由用户首登改密） -->
    <Modal :open="!!pwShow" :title="pwShow?.title ?? ''" @close="pwShow = null">
      <template v-if="pwShow">
        <p>
          用户 <b>{{ pwShow.username }}</b> 的临时口令（仅展示这一次）：
        </p>
        <div class="pw-row">
          <code class="mono">{{ pwShow.password }}</code>
          <button class="btn btn-pearl" @click="copyPw">复制</button>
        </div>
        <p class="hint">请通过带外渠道交付；用户首次登录时会被要求修改密码。</p>
      </template>
      <template #foot>
        <button class="btn btn-primary" @click="pwShow = null">我已保存</button>
      </template>
    </Modal>

    <!-- M1 新建用户组 -->
    <Modal :open="groupModal" title="新建用户组" @close="groupModal = false">
      <div class="field">
        <label>组名</label>
        <input v-model="groupForm.name" class="input" type="text" placeholder="如 sdp-admin / team-deployer" />
        <p class="hint">不能包含 /（不支持嵌套）；org: 前缀是组织载体组保留名。</p>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="groupModal = false">取消</button>
        <button class="btn btn-primary" :disabled="groupSaving" @click="saveGroup">
          {{ groupSaving ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- M1 组成员管理 -->
    <Modal :open="membersModal" :title="`成员管理 · ${membersGroup?.name ?? ''}`" @close="membersModal = false">
      <div class="field">
        <label>添加成员</label>
        <div class="pw-row">
          <select v-model="memberToAdd" class="input">
            <option value="">选择用户…</option>
            <option v-for="u in dirUsers" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
          <button class="btn btn-pearl" @click="addMember">添加</button>
        </div>
      </div>
      <div class="card flush">
        <div v-if="membersLoading" class="loading">加载中…</div>
        <div v-else-if="members.length === 0" class="empty">暂无成员</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>邮箱</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in members" :key="u.id">
              <td class="mono" :title="u.id">{{ u.username }}</td>
              <td>{{ u.email || '—' }}</td>
              <td><a style="color: var(--failed-fg)" @click="removeMember(u)">移出</a></td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #foot>
        <button class="btn btn-primary" @click="membersModal = false">完成</button>
      </template>
    </Modal>

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
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId">{{ s.label }}</option>
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else>候选来自用户目录与已绑定主体；新主体直接粘贴 <code>sub</code> 即可。</p>
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
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId">{{ s.label }}</option>
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else>组主体须带前导斜杠（realm groups mapper 为 full.path）；候选来自组目录与已绑定主体，/org:* 为平台托管只读组。</p>
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

    <!-- Runner 安装命令（ADR-0002 join-bundle）：目标机自举脚本 + 复制 -->
    <Modal :open="joinModal" :title="`Runner 安装命令 — ${joinBundle?.targetName ?? ''}`" :width="720" @close="joinModal = false">
      <div v-if="joinLoading" class="loading">生成中…</div>
      <div v-else-if="joinErr" class="empty">{{ joinErr }}</div>
      <template v-else-if="joinBundle && joinCmd">
        <p class="hint">
          网关 <code class="mono">{{ joinBundle.gatewayUrl }}</code>
          · CA 指纹 <code class="mono">{{ joinBundle.caFingerprint }}</code>
          · enroll token {{ joinBundle.expiresIn }} 内有效（per-target 一次性）
        </p>
        <div class="field">
          <label>
            自举脚本（目标机上以 root 执行：落盘 CA + 指纹自校验 + 环境文件）
            <button class="btn btn-pearl btn-sm" style="margin-left: 8px" @click="copyJoin('script')">
              {{ joinCopied === 'script' ? '✓ 已复制' : '复制脚本' }}
            </button>
          </label>
          <pre class="enroll-token mono">{{ joinFullScript }}</pre>
        </div>
        <div class="field">
          <label>
            环境文件（/etc/sdp-runner/sdp-runner.env，装机管线可拆出单独消费）
            <button class="btn btn-pearl btn-sm" style="margin-left: 8px" @click="copyJoin('env')">
              {{ joinCopied === 'env' ? '✓ 已复制' : '复制 env' }}
            </button>
          </label>
          <pre class="enroll-token mono">{{ joinCmd.envFile }}</pre>
        </div>
        <p class="hint">{{ joinCmd.verifyCommand }}；unattended 场景把本弹窗脚本内嵌进 cloud-init userdata（ADR-0002 §2）。</p>
      </template>
      <template #foot>
        <button class="btn btn-primary" @click="joinModal = false">关闭</button>
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
.pw-row { display: flex; align-items: center; gap: 10px; }
.pw-row > code {
  flex: 1; padding: 10px 12px; background: var(--term-bg); color: var(--term-fg);
  border-radius: 8px; font-size: 13px; letter-spacing: 1px; word-break: break-all;
}
.pw-row > select { flex: 1; }
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
