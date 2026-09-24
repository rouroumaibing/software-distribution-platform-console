<script setup lang="ts">
// 权限 Tab：组件级 RBAC（role-bindings），§7 主体模型。
// 主体支持 user / group 两种 subject_type；角色选择器使用 §7 component_roles
// （内置 viewer/editor/approver/admin + 组织自定义）。
//
// D3 之后 hub 不存用户表，控制台**没有用户目录**：主体从「已绑定主体」下拉候选里
// 挑，或直接手输 `sub` / 组路径。平台级授权在「平台管理」。
import { computed, onMounted, reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { permissionApi, type ComponentRole, type ComponentRoleBinding } from '@/api/permission'
import {
  failMsg,
  knownSubjects,
  subjectInputHint,
  subjectLabel,
  validateSubjectInput,
  type SubjectType,
} from '@/utils/permission'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const bindings = ref<ComponentRoleBinding[]>([])
const componentRoles = ref<ComponentRole[]>([]) // §7 角色
const loading = ref(true)
const modal = ref(false)
const saving = ref(false)

const form = reactive({
  subjectType: 'user' as SubjectType,
  subjectValue: '',
  componentRoleId: '',
})

// 下拉候选 = 本组件**已绑定过**的主体（去重、按当前类型过滤）。
// 它只是省事的候选，不是白名单 —— 手输任何合法主体都允许。
const subjectOptions = computed(() =>
  knownSubjects(bindings.value).filter((s) => s.subjectType === form.subjectType),
)
const subjectHint = computed(() => subjectInputHint(form.subjectType, form.subjectValue))

function resetForm() {
  form.subjectType = 'user'
  form.subjectValue = ''
  form.componentRoleId = ''
}

onMounted(async () => {
  try {
    componentRoles.value = await permissionApi.componentRoles.list()
    await load()
  } finally {
    loading.value = false
  }
})

async function load() {
  bindings.value = await permissionApi.bindings.listByComponent(props.componentId)
}

async function save() {
  const invalid = validateSubjectInput(form.subjectType, form.subjectValue)
  if (invalid) {
    toast.err(invalid)
    return
  }
  if (!form.componentRoleId) {
    toast.err('请选择组件角色')
    return
  }
  saving.value = true
  try {
    await permissionApi.bindings.create(props.componentId, {
      subjectType: form.subjectType,
      subjectId: form.subjectValue.trim(),
      componentRoleId: form.componentRoleId,
    })
    toast.ok('已添加绑定')
    modal.value = false
    resetForm()
    await load()
  } catch (e) {
    toast.err(failMsg(e))
  } finally {
    saving.value = false
  }
}

async function remove(id: string) {
  try {
    await permissionApi.bindings.remove(id)
    toast.ok('已解绑')
    await load()
  } catch (e) {
    toast.err(failMsg(e))
  }
}

const componentRoleById = (id?: string) => componentRoles.value.find((r) => r.id === id)
const roleLabel = (b: ComponentRoleBinding) =>
  b.componentRoleId ? (componentRoleById(b.componentRoleId)?.name ?? b.componentRoleId.slice(0, 8)) : '—'
const subjectTypeBadge = (b: ComponentRoleBinding) => (b.subjectType === 'group' ? '组' : '用户')
</script>

<template>
  <div>
    <div class="perm-note">
      这里管理<b>对这个组件</b>的授权（role-bindings）；平台级权限在左侧
      <b>平台管理 → 用户与平台权限</b>。
    </div>
    <div class="perm-note">
      主体按 Keycloak 的 <b>`sub`</b> 标识（用户组按组路径）。hub <b>不存用户表</b>，
      所以这里没有人员名单可拉 —— 下拉候选来自本组件<b>已绑定过</b>的主体，新主体请直接填入
      `sub`（在 Keycloak 用户详情里复制）。
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
            <td class="mono" :title="subjectLabel(b)">{{ subjectLabel(b) }}</td>
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
        <label>用户 sub</label>
        <input
          v-model="form.subjectValue"
          class="input"
          type="text"
          list="component-subject-options"
          placeholder="Keycloak 用户详情里的 sub（uuid），不是用户名"
        />
        <datalist id="component-subject-options">
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId" />
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else-if="subjectOptions.length === 0">
          本组件还没有绑定过用户，直接粘贴 `sub` 即可。
        </p>
      </div>

      <div class="field" v-else>
        <label>用户组路径</label>
        <input
          v-model="form.subjectValue"
          class="input"
          type="text"
          list="component-subject-options"
          placeholder="带前导斜杠，如 /sdp-admin"
        />
        <datalist id="component-subject-options">
          <option v-for="s in subjectOptions" :key="s.subjectId" :value="s.subjectId" />
        </datalist>
        <p class="hint" v-if="subjectHint">{{ subjectHint }}</p>
        <p class="hint" v-else>组值取自 token 的 groups claim，本 realm 为 `full.path` ⇒ 必须带前导斜杠。</p>
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
/* 本块原先引用了三个**从未定义**的令牌（--border / --primary / --muted-fg）——
   无效声明会被整条丢弃，等于边框/文字色静默失效。本轮统一到 §9.2 权威名。 */
.perm-note {
  background: var(--accent-soft);
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 4px;
}
.perm-note.warn {
  background: var(--warning-bg);
  border-color: transparent;
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
.input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  font-size: 13px;
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
}
</style>
