<script setup lang="ts">
// 环境 Tab：该组件的环境列表 + 新建环境（原 EnvironmentView 组件内逻辑，去级联；
// 集群健康属平台级 → 平台管理页）。
import { onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { clusterApi, type Cluster } from '@/api/cluster'
import { environmentApi, type Environment } from '@/api/environment'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const envs = ref<Environment[]>([])
const clusters = ref<Cluster[]>([])
const loading = ref(true)

const createOpen = ref(false)
const creating = ref(false)
const form = ref({ key: '', name: '', clusterId: '', envType: 'test' as 'test' | 'production', namespace: '' })

onMounted(async () => {
  try {
    const [e, c] = await Promise.all([
      environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 100 }),
      clusterApi.list({ page: 1, pageSize: 100 }).catch(() => ({ items: [] })),
    ])
    envs.value = e.items
    clusters.value = c.items
  } finally {
    loading.value = false
  }
})

function openCreate() {
  if (clusters.value.length === 0) {
    toast.err('尚无已注册集群，请先让 Runner 上线注册')
    return
  }
  form.value = { key: '', name: '', clusterId: clusters.value[0].id, envType: 'test', namespace: '' }
  createOpen.value = true
}

async function create() {
  const f = form.value
  if (!f.key.trim() || !f.name.trim() || !f.namespace.trim() || !f.clusterId) {
    toast.err('Key、名称、命名空间与目标集群均必填')
    return
  }
  creating.value = true
  try {
    const e = await environmentApi.create({
      componentId: props.componentId,
      key: f.key.trim(),
      name: f.name.trim(),
      clusterId: f.clusterId,
      envType: f.envType,
      namespace: f.namespace.trim(),
    })
    toast.ok(`环境「${e.name}」已创建`)
    createOpen.value = false
    envs.value = (await environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })).items
  } catch (e: any) {
    toast.err('创建失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" @click="openCreate">＋ 新建环境</button>
    </div>
    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="envs.length === 0" class="empty">
        <p>该组件下暂无环境</p>
        <button class="btn btn-primary btn-sm" @click="openCreate">＋ 创建第一个环境</button>
      </div>
      <table v-else class="table">
        <thead><tr><th>名称</th><th>类型</th><th>命名空间</th><th>集群</th></tr></thead>
        <tbody>
          <tr v-for="e in envs" :key="e.id">
            <td><b>{{ e.name }}</b></td>
            <td>
              <span class="badge" :class="e.envType === 'production' ? 'b-fail' : 'b-pend'">
                <span class="pt"></span>{{ e.envType }}
              </span>
            </td>
            <td class="mono">{{ e.namespace }}</td>
            <td>{{ clusters.find((c) => c.id === e.clusterId)?.name ?? e.clusterId.slice(0, 8) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal :open="createOpen" title="新建环境" @close="createOpen = false">
      <div class="field">
        <label>Key *</label>
        <input v-model="form.key" class="input" placeholder="英文标识，如 prod" maxlength="64" />
      </div>
      <div class="field">
        <label>名称 *</label>
        <input v-model="form.name" class="input" placeholder="如：生产环境" maxlength="128" />
      </div>
      <div class="field">
        <label>类型</label>
        <select v-model="form.envType" class="select">
          <option value="test">test（测试）</option>
          <option value="production">production（生产）</option>
        </select>
      </div>
      <div class="field">
        <label>目标集群 *</label>
        <select v-model="form.clusterId" class="select">
          <option v-for="c in clusters" :key="c.id" :value="c.id">
            {{ c.name }}（{{ c.status === 'online' ? '在线' : '离线' }}）
          </option>
        </select>
      </div>
      <div class="field">
        <label>命名空间 *</label>
        <input v-model="form.namespace" class="input" placeholder="如：user-center-prod" maxlength="128" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="creating" @click="create">
          {{ creating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
