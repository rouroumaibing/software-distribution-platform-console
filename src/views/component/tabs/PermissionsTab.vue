<script setup lang="ts">
// 权限 Tab：组件级 RBAC（role-bindings）。平台级用户/角色在「平台管理」。
// 原详情页 access 区块迁移。
import { onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { permissionApi, type User, type Role, type ComponentRoleBinding } from '@/api/permission'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const bindings = ref<ComponentRoleBinding[]>([])
const users = ref<User[]>([])
const roles = ref<Role[]>([])
const loading = ref(true)
const modal = ref(false)
const form = ref({ userId: '', roleId: '' })

onMounted(async () => {
  try {
    await load()
    const [u, r] = await Promise.all([
      permissionApi.users.list({ page: 1, pageSize: 100 }),
      permissionApi.roles.list(),
    ])
    users.value = u.items
    roles.value = r
  } finally {
    loading.value = false
  }
})

async function load() {
  bindings.value = await permissionApi.bindings.listByComponent(props.componentId)
}

async function save() {
  if (!form.value.userId || !form.value.roleId) {
    toast.err('请选择用户和角色')
    return
  }
  await permissionApi.bindings.create(props.componentId, form.value)
  toast.ok('已添加绑定')
  modal.value = false
  await load()
}

async function remove(id: string) {
  await permissionApi.bindings.remove(id)
  toast.ok('已解绑')
  await load()
}

const userName = (id: string) => users.value.find((u) => u.id === id)?.name ?? id.slice(0, 8)
const roleName = (id: string) => roles.value.find((r) => r.id === id)?.name ?? id.slice(0, 8)
</script>

<template>
  <div>
    <div class="perm-note">
      这里管理<b>对这个组件</b>的授权（role-bindings）；平台级用户与角色在左侧
      <b>平台管理 → 用户与平台权限</b>。
    </div>
    <div class="toolbar">
      <div class="spacer"></div>
      <button class="btn btn-pearl" @click="modal = true">＋ 添加绑定</button>
    </div>
    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="bindings.length === 0" class="empty">暂无角色绑定</div>
      <table v-else class="table">
        <thead><tr><th>用户</th><th>角色</th><th>授权时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="b in bindings" :key="b.id">
            <td>{{ userName(b.userId) }}</td>
            <td><span class="chip">{{ roleName(b.roleId) }}</span></td>
            <td class="mono">{{ new Date(b.grantedAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
            <td><a style="color: var(--failed-fg)" @click="remove(b.id)">解绑</a></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal :open="modal" title="添加角色绑定" @close="modal = false">
      <div class="field">
        <label>用户</label>
        <select v-model="form.userId" class="select">
          <option value="">选择用户</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}（{{ u.email }}）</option>
        </select>
      </div>
      <div class="field">
        <label>角色</label>
        <select v-model="form.roleId" class="select">
          <option value="">选择角色</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="modal = false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.perm-note {
  background: var(--action-blue-soft); border: 1px solid #c6dafc;
  border-radius: var(--radius-card); padding: 10px 14px;
  font-size: 13px; margin-bottom: 4px;
}
</style>
