<script setup lang="ts">
// 资源级联选择器：Org → ServiceTree → Service → Component(→ Pipeline)。
// 后端没有全局列表端点,菜单页(组件/流水线/运行/制品库/环境/权限)用它定位上下文。
import { onMounted, ref, watch } from 'vue'
import { orgApi, type Org, type ServiceTree } from '@/api/org'
import { catalogApi, type Service } from '@/api/catalog'
import { componentApi, type Component } from '@/api/component'
import { pipelineApi, type Pipeline } from '@/api/pipeline'

export interface CascadeSelection {
  org?: Org
  tree?: ServiceTree
  service?: Service
  component?: Component
  pipeline?: Pipeline
}

const props = withDefaults(defineProps<{ level?: 'component' | 'pipeline' }>(), {
  level: 'component',
})
const emit = defineEmits<{ select: [sel: CascadeSelection] }>()

const orgs = ref<Org[]>([])
const tree = ref<ServiceTree>()
const services = ref<Service[]>([])
const components = ref<Component[]>([])
const pipelines = ref<Pipeline[]>([])

const orgId = ref('')
const serviceId = ref('')
const componentId = ref('')
const pipelineId = ref('')
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const p = await orgApi.list({ page: 1, pageSize: 100 })
    orgs.value = p.items
    if (orgs.value.length > 0) {
      orgId.value = orgs.value[0].id
      await loadTree()
    }
  } finally {
    loading.value = false
  }
})

async function loadTree() {
  tree.value = undefined
  services.value = []
  components.value = []
  pipelines.value = []
  serviceId.value = componentId.value = pipelineId.value = ''
  if (!orgId.value) return
  const org = orgs.value.find((o) => o.id === orgId.value)
  try {
    tree.value = await orgApi.getServiceTree(orgId.value)
    const p = await catalogApi.listByServiceTree(tree.value.id, { page: 1, pageSize: 100 })
    services.value = p.items
    if (services.value.length > 0) {
      serviceId.value = services.value[0].id
      await loadComponents()
    } else {
      emitSel(org)
    }
  } catch {
    emitSel(org)
  }
}

async function loadComponents() {
  components.value = []
  pipelines.value = []
  componentId.value = pipelineId.value = ''
  if (!serviceId.value) return
  const p = await componentApi.listByService(serviceId.value, { page: 1, pageSize: 100 })
  components.value = p.items
  if (components.value.length > 0) {
    componentId.value = components.value[0].id
    if (props.level === 'pipeline') await loadPipelines()
    else emitSel()
  } else {
    emitSel()
  }
}

async function loadPipelines() {
  pipelines.value = []
  pipelineId.value = ''
  if (!componentId.value) return
  const p = await pipelineApi.listByComponent(componentId.value, { page: 1, pageSize: 100 })
  pipelines.value = p.items
  if (pipelines.value.length > 0) pipelineId.value = pipelines.value[0].id
  emitSel()
}

function emitSel(orgOverride?: Org) {
  emit('select', {
    org: orgOverride ?? orgs.value.find((o) => o.id === orgId.value),
    tree: tree.value,
    service: services.value.find((s) => s.id === serviceId.value),
    component: components.value.find((c) => c.id === componentId.value),
    pipeline: pipelines.value.find((p) => p.id === pipelineId.value),
  })
}

watch(orgId, loadTree)
watch(serviceId, loadComponents)
watch(componentId, () => {
  if (props.level === 'pipeline') loadPipelines()
  else emitSel()
})
watch(pipelineId, () => emitSel())
</script>

<template>
  <div class="cascade">
    <select v-model="orgId" class="select" :disabled="loading || orgs.length === 0">
      <option v-for="o in orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
    </select>
    <span class="sep">/</span>
    <select v-model="serviceId" class="select" :disabled="services.length === 0">
      <option v-if="services.length === 0" value="">（无服务）</option>
      <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
    </select>
    <span class="sep">/</span>
    <select v-model="componentId" class="select" :disabled="components.length === 0">
      <option v-if="components.length === 0" value="">（无组件）</option>
      <option v-for="c in components" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <template v-if="level === 'pipeline'">
      <span class="sep">/</span>
      <select v-model="pipelineId" class="select" :disabled="pipelines.length === 0">
        <option v-if="pipelines.length === 0" value="">（无流水线）</option>
        <option v-for="p in pipelines" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </template>
  </div>
</template>

<style scoped>
.cascade { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.select { width: auto; min-width: 150px; }
.sep { color: var(--sub); }
</style>
