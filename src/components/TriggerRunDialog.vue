<script setup lang="ts">
// 触发运行对话框(MOD-4)：选目标集群 + 参数注入(预置组件参数管理的 key,可改值)。
import { onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { runApi, type PipelineRun, type Param } from '@/api/run'
import { clusterApi, type Cluster } from '@/api/cluster'
import { componentApi, type ComponentConfig } from '@/api/component'
import { toast } from '@/utils/toast'

const props = defineProps<{
  open: boolean
  pipelineId: string
  componentId?: string
}>()
const emit = defineEmits<{ close: []; triggered: [run: PipelineRun] }>()

const clusters = ref<Cluster[]>([])
const clusterId = ref('')
const namespace = ref('')
const params = ref<Param[]>([])
const triggering = ref(false)

onMounted(async () => {
  const p = await clusterApi.list({ page: 1, pageSize: 100 })
  clusters.value = p.items
  if (clusters.value.length > 0) clusterId.value = clusters.value[0].id
})

// 打开时把组件参数管理里的 key 预置为本次运行参数(值可改)。
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    params.value = []
    if (!props.componentId) return
    try {
      const res = await componentApi.listConfigs(props.componentId)
      const items: ComponentConfig[] = res?.items ?? res ?? []
      params.value = items.map((c) => ({ name: c.key, value: c.isSecret ? '' : (c.value ?? '') }))
    } catch {
      // 参数预置失败不阻塞触发
    }
  },
)

function addParam() {
  params.value.push({ name: '', value: '' })
}

async function trigger() {
  triggering.value = true
  try {
    const run = await runApi.trigger(props.pipelineId, {
      clusterId: clusterId.value || undefined,
      targetNamespace: namespace.value || undefined,
      params: params.value.filter((p) => p.name.trim()),
    })
    toast.ok(`已触发运行 ${run.crName || run.id}`)
    emit('triggered', run)
    emit('close')
  } catch (e: any) {
    toast.err('触发失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    triggering.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="触发运行" :width="560" @close="emit('close')">
    <div class="field">
      <label>目标集群</label>
      <select v-model="clusterId" class="select">
        <option v-if="clusters.length === 0" value="">（无可用集群）</option>
        <option v-for="c in clusters" :key="c.id" :value="c.id">
          {{ c.name }}（{{ c.status === 'online' ? '在线' : '离线' }}）
        </option>
      </select>
    </div>
    <div class="field">
      <label>目标命名空间（可选）</label>
      <input v-model="namespace" class="input" placeholder="留空使用流水线默认" />
    </div>
    <div class="field">
      <label>运行参数（注入任务 command/args/env）</label>
      <div v-for="(p, i) in params" :key="i" class="kv-row">
        <input v-model="p.name" class="input" placeholder="name" />
        <input v-model="p.value" class="input" placeholder="value" />
        <button class="kv-del" @click="params.splice(i, 1)">×</button>
      </div>
      <button class="link-btn" @click="addParam">＋ 添加参数</button>
      <div class="hint">已预置组件参数管理中的 key；留空的 secret 值将由后端按 secretRef 解析。</div>
    </div>
    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="triggering || !clusterId" @click="trigger">
        {{ triggering ? '触发中…' : '▶ 触发' }}
      </button>
    </template>
  </Modal>
</template>
