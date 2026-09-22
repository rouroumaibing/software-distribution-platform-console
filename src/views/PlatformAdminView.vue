<script setup lang="ts">
// 平台管理（IA v2）：用户与平台权限（平台级 RBAC，C-10 端点）/ 接入管理。
// 组件级授权在各组件详情的「权限」Tab —— 权限双轨的平台侧半边。
import { onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import {
  permissionApi,
  type User,
  type PlatformRole,
  type PlatformRoleBinding,
} from '@/api/permission'
import { targetApi, type Target } from '@/api/target'
import { toast } from '@/utils/toast'
import { parseActions, formatExpiryISO } from '@/utils/permission'

const props = defineProps<{ section: 'permissions' | 'targets' }>()

const users = ref<User[]>([])
const roles = ref<PlatformRole[]>([]) // §7.2 平台角色（C-10，可管理）
const bindings = ref<PlatformRoleBinding[]>([]) // 平台级绑定（C-10，可管理）
const targets = ref<Target[]>([])
const loading = ref(true)

const userById = (id?: string) => users.value.find((u) => u.id === id)
const roleById = (id?: string) => roles.value.find((r) => r.id === id)

// 统一把 axios 错误翻成可展示文案：优先结构化的 reasons（如 409 删除被拒理由），
// 其次服务端 error 字段，最后兜底 message。
function failMsg(e: unknown): string {
  const d = (e as { response?: { data?: { reasons?: string[]; error?: string } } })?.response?.data
  if (d?.reasons?.length) return d.reasons.join('、')
  if (d?.error) return d.error
  return (e as { message?: string })?.message || '操作失败'
}

async function loadRoles() {
  roles.value = await permissionApi.platformRoles.list()
}
async function loadBindings() {
  bindings.value = await permissionApi.platformBindings.list()
}

onMounted(async () => {
  try {
    if (props.section === 'permissions') {
      const [u] = await Promise.all([permissionApi.users.list({ page: 1, pageSize: 100 })])
      users.value = u.items
      await Promise.all([loadRoles(), loadBindings()])
    } else {
      const c = await targetApi.list({ page: 1, pageSize: 100 })
      targets.value = c.items
    }
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
// 平台权限绑定（CRUD）
// ---------------------------------------------------------------------------
const bindModal = ref(false)
const bindSaving = ref(false)
const bindForm = reactive({
  subjectType: 'user' as 'user' | 'group',
  userId: '',
  groupName: '',
  platformRoleId: '',
  expiresAt: '',
})
function resetBindForm() {
  bindForm.subjectType = 'user'
  bindForm.userId = ''
  bindForm.groupName = ''
  bindForm.platformRoleId = ''
  bindForm.expiresAt = ''
}
function openCreateBinding() {
  resetBindForm()
  bindModal.value = true
}
async function saveBinding() {
  if (bindForm.subjectType === 'user') {
    if (!bindForm.userId) {
      toast.err('请选择用户')
      return
    }
  } else {
    if (!bindForm.groupName.trim()) {
      toast.err('请填写用户组名称')
      return
    }
  }
  if (!bindForm.platformRoleId) {
    toast.err('请选择平台角色')
    return
  }
  const expiresAt = formatExpiryISO(bindForm.expiresAt)
  const payload = {
    subjectType: bindForm.subjectType,
    subjectId: bindForm.subjectType === 'user' ? bindForm.userId : bindForm.groupName.trim(),
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
      <h1 class="title">{{ section === 'permissions' ? '用户与平台权限' : '接入管理' }}</h1>
      <div class="sub">
        平台级管理 · 组件级授权在各组件详情的「权限」Tab
      </div>
    </div>

    <div class="tabs" style="margin-top: 0">
      <router-link class="tab" :class="{ active: section === 'permissions' }" to="/admin/permissions">用户与平台权限</router-link>
      <router-link class="tab" :class="{ active: section === 'targets' }" to="/admin/targets">接入管理</router-link>
    </div>

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
              <td>
                {{
                  b.subjectType === 'group'
                    ? '组：' + (b.subjectId ?? '')
                    : userById(b.subjectId)
                      ? userById(b.subjectId)!.name + '（' + userById(b.subjectId)!.email + '）'
                      : (b.subjectId ?? '').slice(0, 8)
                }}
              </td>
              <td><span class="chip">{{ roleById(b.platformRoleId)?.name ?? b.platformRoleId.slice(0, 8) }}</span></td>
              <td class="mono">{{ b.expiresAt ? new Date(b.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久' }}</td>
              <td class="mono">{{ new Date(b.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
              <td><a style="color: var(--failed-fg)" @click="removeBinding(b.id)">解绑</a></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 用户（只读，绑定选择器来源） -->
      <h2 class="h2">用户</h2>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="users.length === 0" class="empty">暂无用户（OIDC 登录后自动注册）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>用户</th>
              <th>邮箱</th>
              <th>加入时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td><b>{{ u.name }}</b></td>
              <td class="mono">{{ u.email }}</td>
              <td class="mono">{{ new Date(u.createdAt).toLocaleDateString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="card flush">
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="targets.length === 0" class="empty">暂无接入目标。Runner 上线后自动注册。</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>厂商</th>
              <th>区域</th>
              <th>状态</th>
              <th>Agent 版本</th>
              <th>最近心跳</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in targets" :key="c.id">
              <td><b>{{ c.name }}</b></td>
              <td>{{ c.vendor || '—' }}</td>
              <td>{{ c.region || '—' }}</td>
              <td>
                <span class="badge" :class="c.status === 'online' ? 'b-succ' : 'b-pend'">
                  <span class="pt"></span>{{ c.status === 'online' ? '在线' : '离线' }}
                </span>
              </td>
              <td class="mono">{{ c.agentVersion || '—' }}</td>
              <td class="mono">{{ fmtHeartbeat(c.lastHeartbeatAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
        <label>用户</label>
        <select v-model="bindForm.userId" class="select">
          <option value="">选择用户</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}（{{ u.email }}）</option>
        </select>
      </div>
      <div class="field" v-else>
        <label>用户组名称</label>
        <input
          v-model="bindForm.groupName"
          class="input"
          type="text"
          placeholder="Keycloak 用户组名（如 /sdp-admin）"
        />
        <p class="hint">组主体须带前导斜杠（本 realm groups mapper 为 full.path）。</p>
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
  </div>
</template>

<style scoped>
/* 表单相关类与 PermissionsTab 同源（tokens.css 未提供全局表单类，故在此 scoped 定义） */
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
.row-actions {
  white-space: nowrap;
}
.row-actions a {
  margin-right: 12px;
  color: var(--accent);
  cursor: pointer;
}
</style>
