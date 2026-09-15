<script setup lang="ts">
// 权限 Tab：组件级 RBAC（role-bindings），§7 主题模型。
// 主体支持 user / group 两种 subject_type；角色选择器使用 §7 component_roles
// （内置 viewer/editor/approver/admin + 组织自定义），不再使用 V1 roles。
// 平台级用户/角色在「平台管理」。
import { onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import {
  permissionApi,
  type User,
  type Role,
  type ComponentRole,
  type ComponentRoleBinding,
} from '@/api/permission'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const bindings = ref<ComponentRoleBinding[]>([])
const users = ref<User[]>([])
const roles = ref<Role[]>([]) // V1 legacy，仅用于旧数据回显
const componentRoles = ref<ComponentRole[]>([]) // §7 角色
const loading = ref(true)
const modal = ref(false)
const saving = ref(false)

const form = reactive({
  subjectType: 'user' as 'user' | 'group',
  userId: '',
  groupName: '',
  componentRoleId: '',
})

function resetForm() {
  form.subjectType = 'user'
  form.userId = ''
  form.groupName = ''
  form.componentRoleId = ''
}

onMounted(async () => {
  try {
    const [u, r, cr] = await Promise.all([
      permissionApi.users.list({ page: 1, pageSize: 100 }),
      permissionApi.roles.list(),
      permissionApi.componentRoles.list(),
    ])
    users.value = u.items
    roles.value = r
    componentRoles.value = cr
    await load()
  } finally {
    loading.value = false
  }
})

async function load() {
  bindings.value = await permissionApi.bindings.listByComponent(props.componentId)
}

async function save() {
  if (form.subjectType === 'user') {
    if (!form.userId) {
      toast.err('请选择用户')
      return
    }
  } else {
    if (!form.groupName.trim()) {
      toast.err('请填写用户组名称')
      return
    }
  }
  if (!form.componentRoleId) {
    toast.err('请选择组件角色')
    return
  }
  const payload = {
    subjectType: form.subjectType,
    subjectId: form.subjectType === 'user' ? form.userId : form.groupName.trim(),
    componentRoleId: form.componentRoleId,
  }
  saving.value = true
  try {
    await permissionApi.bindings.create(props.componentId, payload)
    toast.ok('已添加绑定')
    modal.value = false
    resetForm()
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(id: string) {
  await permissionApi.bindings.remove(id)
  toast.ok('已解绑')
  await load()
}

const userById = (id?: string) => users.value.find((u) => u.id === id)
const roleById = (id?: string) => roles.value.find((r) => r.id === id)
const componentRoleById = (id?: string) => componentRoles.value.find((r) => r.id === id)

// 主体显示：优先 §7 subjectType，旧数据回退到 V1 userId。
function subjectLabel(b: ComponentRoleBinding): string {
  if (b.subjectType === 'group') return `组：${b.subjectId ?? ''}`
  if (b.subjectType === 'user') {
    const u = userById(b.subjectId)
    return u ? `${u.name}（${u.email}）` : (b.subjectId ?? '').slice(0, 8)
  }
  // V1 legacy 回显
  const u = userById(b.userId)
  return u ? `${u.name}（${u.email}）` : (b.userId ?? '').slice(0, 8)
}

// 角色显示：优先 §7 componentRoleId，旧数据回退到 V1 roleId。
function roleLabel(b: ComponentRoleBinding): string {
  if (b.componentRoleId) return componentRoleById(b.componentRoleId)?.name ?? b.componentRoleId.slice(0, 8)
  if (b.roleId) return roleById(b.roleId)?.name ?? b.roleId.slice(0, 8)
  return '—'
}

const subjectTypeBadge = (b: ComponentRoleBinding) =>
  b.subjectType === 'group' ? '组' : b.subjectType === 'user' ? '用户' : '用户(V1)'
</script>

<template>
  <div>
    <div class="perm-note">
      这里管理<b>对这个组件</b>的授权（role-bindings）；平台级用户与角色在左侧
      <b>平台管理 → 用户与平台权限</b>。
    </div>
    <div class="perm-note warn">
      <b>自审拦截：</b>组件 owner 触发含审批节点的流水线后，<b>不能审批自己触发的这次运行</b>。
      请确保除 owner 外，另有用户或用户组被授予 <b>component-approver</b>（推荐用组，避免单人阻塞）。
    </div>

    <div class="toolbar">
      <div class="spacer"></div>
      <button class="btn btn-pearl" @click="modal = true">＋ 添加绑定</button>
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="bindings.length === 0" class="empty">暂无角色绑定</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>类型</th>
            <th>主体</th>
            <th>组件角色</th>
            <th>授权时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bindings" :key="b.id">
            <td><span class="badge">{{ subjectTypeBadge(b) }}</span></td>
            <td>{{ subjectLabel(b) }}</td>
            <td><span class="chip">{{ roleLabel(b) }}</span></td>
            <td class="mono">{{ new Date(b.grantedAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
            <td><a style="color: var(--failed-fg)" @click="remove(b.id)">解绑</a></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal :open="modal" title="添加角色绑定" @close="modal = false">
      <div class="field">
        <label>主体类型</label>
        <div class="seg">
          <label :class="{ active: form.subjectType === 'user' }">
            <input type="radio" value="user" v-model="form.subjectType" /> 用户
          </label>
          <label :class="{ active: form.subjectType === 'group' }">
            <input type="radio" value="group" v-model="form.subjectType" /> 用户组
          </label>
        </div>
      </div>

      <div class="field" v-if="form.subjectType === 'user'">
        <label>用户</label>
        <select v-model="form.userId" class="select">
          <option value="">选择用户</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}（{{ u.email }}）</option>
        </select>
      </div>

      <div class="field" v-else>
        <label>用户组名称</label>
        <input
          v-model="form.groupName"
          class="input"
          type="text"
          placeholder="Keycloak 用户组名（如 platform-eng）"
        />
        <p class="hint">用户组来自 Keycloak，hub 当前不提供组目录，请填写准确的组名。</p>
      </div>

      <div class="field">
        <label>组件角色（§7）</label>
        <select v-model="form.componentRoleId" class="select">
          <option value="">选择组件角色</option>
          <option v-for="r in componentRoles" :key="r.id" :value="r.id">
            {{ r.name }}{{ r.isSystem ? '（内置）' : '（自定义）' }}
          </option>
        </select>
      </div>

      <template #foot>
        <button class="btn btn-pearl" @click="modal = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.perm-note {
  background: var(--action-blue-soft);
  border: 1px solid #c6dafc;
  border-radius: var(--radius-card);
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 4px;
}
.perm-note.warn {
  background: #fff7e6;
  border-color: #ffd591;
}
.field .hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted-fg);
}
.seg {
  display: flex;
  gap: 8px;
}
.seg label {
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.seg label.active {
  border-color: var(--primary);
  background: var(--action-blue-soft);
  color: var(--primary);
}
.input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  font-size: 13px;
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--action-blue-soft);
  color: var(--primary);
  font-size: 12px;
}
</style>
