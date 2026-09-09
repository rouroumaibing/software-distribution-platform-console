<script setup lang="ts">
// 流水线 Tab：该组件的流水线列表（原 PipelineListView 的组件内逻辑，去级联）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { pipelineApi, type Pipeline } from '@/api/pipeline'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()
const router = useRouter()

const pipelines = ref<Pipeline[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const p = await pipelineApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })
    pipelines.value = p.items
  } finally {
    loading.value = false
  }
})

function openEditor(p: Pipeline) {
  if (p.kind !== 'build') {
    toast.err('M1 仅支持编排 build 类型流水线')
    return
  }
  router.push(`/pipelines/${p.id}`)
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="spacer"></div>
      <!-- 新建入口走服务树/触发对话框已有路径，此处仅编排已有流水线 -->
      <span class="sub">共 {{ pipelines.length }} 条流水线</span>
    </div>
    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="pipelines.length === 0" class="empty">暂无流水线</div>
      <table v-else class="table">
        <thead><tr><th>名称</th><th>类型</th><th>版本</th><th>描述</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in pipelines" :key="p.id" style="cursor: pointer" @click="openEditor(p)">
            <td><b>{{ p.name }}</b></td>
            <td><span class="chip">{{ p.kind }}</span></td>
            <td>v{{ p.version }}</td>
            <td>{{ p.description || '—' }}</td>
            <td><a>编排 →</a></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
