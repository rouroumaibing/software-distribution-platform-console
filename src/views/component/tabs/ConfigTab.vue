<script setup lang="ts">
// 配置（参数管理）Tab：由原 ComponentDetailView 单页的 config 区块迁移。
import { onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { componentApi, type ComponentConfig } from '@/api/component'
import { environmentApi, type Environment } from '@/api/environment'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const configs = ref<ComponentConfig[]>([])
const envs = ref<Environment[]>([])
const envFilter = ref('')
const loading = ref(true)
const modal = ref(false)
const editing = ref<ComponentConfig | null>(null)
const form = ref({ key: '', value: '', isSecret: false, secretRef: '', description: '', environmentId: '' })

onMounted(async () => {
  try {
    await load()
    envs.value = (await environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }).catch(() => ({ items: [] }))).items
  } finally {
    loading.value = false
  }
})

async function load() {
  const res = await componentApi.listConfigs(props.componentId, envFilter.value || undefined)
  configs.value = res?.items ?? res ?? []
}

function openCreate() {
  editing.value = null
  form.value = { key: '', value: '', isSecret: false, secretRef: '', description: '', environmentId: '' }
  modal.value = true
}

function openEdit(c: ComponentConfig) {
  editing.value = c
  form.value = {
    key: c.key,
    value: c.value ?? '',
    isSecret: c.isSecret,
    secretRef: c.secretRef ?? '',
    description: c.description ?? '',
    environmentId: c.environmentId ?? '',
  }
  modal.value = true
}

async function save() {
  const f = form.value
  if (!f.key.trim()) {
    toast.err('请填写参数 key')
    return
  }
  try {
    await componentApi.upsertConfig(props.componentId, f.key.trim(), {
      value: f.value || undefined,
      isSecret: f.isSecret,
      secretRef: f.secretRef || undefined,
      description: f.description || undefined,
      environmentId: f.environmentId || undefined,
    })
    toast.ok('参数已保存')
    modal.value = false
    await load()
  } catch (e: any) {
    toast.err('保存失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  }
}

async function remove(c: ComponentConfig) {
  try {
    await componentApi.deleteConfig(props.componentId, c.key)
    toast.ok('已删除')
    await load()
  } catch (e: any) {
    toast.err('删除失败（后端暂不支持）：' + (e?.response?.data?.error ?? ''))
  }
}

const envName = (id?: string) => envs.value.find((e) => e.id === id)?.name ?? (id ? id.slice(0, 8) : '全局')
</script>

<template>
  <div>
    <div class="toolbar">
      <select v-model="envFilter" class="select" style="width: auto" @change="load">
        <option value="">全部环境</option>
        <option v-for="e in envs" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-pearl" @click="openCreate">＋ 新增参数</button>
    </div>
    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="configs.length === 0" class="empty">暂无参数。参数将在触发运行时注入任务。</div>
      <table v-else class="table">
        <thead>
          <tr><th>参数 Key</th><th>值</th><th>类型</th><th>来源</th><th>环境</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in configs" :key="c.id">
            <td class="mono"><b>{{ c.key }}</b></td>
            <td class="mono">{{ c.isSecret ? '••••••' : (c.value ?? '—') }}</td>
            <td>{{ c.isSecret ? 'secret' : 'string' }}</td>
            <td><span v-if="c.secretRef" class="chip">{{ c.secretRef }}</span><span v-else>明文</span></td>
            <td>{{ envName(c.environmentId) }}</td>
            <td style="white-space: nowrap">
              <a @click="openEdit(c)">编辑</a> ·
              <a style="color: var(--failed-fg)" @click="remove(c)">删除</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal :open="modal" :title="editing ? `编辑参数 · ${editing.key}` : '新增参数'" @close="modal = false">
      <div class="field">
        <label>Key</label>
        <input v-model="form.key" class="input mono" :disabled="!!editing" placeholder="如 DATABASE_URL" />
      </div>
      <div class="field">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer">
          <input v-model="form.isSecret" type="checkbox" style="width: auto" /> 保密值（Secret）
        </label>
      </div>
      <div v-if="!form.isSecret" class="field">
        <label>Value</label>
        <input v-model="form.value" class="input mono" />
      </div>
      <div v-else class="field">
        <label>Secret 引用</label>
        <input v-model="form.secretRef" class="input mono" placeholder="如 vault://redis/password" />
      </div>
      <div class="two">
        <div class="field">
          <label>环境（可选）</label>
          <select v-model="form.environmentId" class="select">
            <option value="">全局</option>
            <option v-for="e in envs" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>描述</label>
          <input v-model="form.description" class="input" />
        </div>
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="modal = false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </Modal>
  </div>
</template>
