<script setup lang="ts">
// 制品 Tab：该组件的制品列表（原 ArtifactListView 的组件内逻辑，去级联）。
import { onMounted, ref } from 'vue'
import { artifactApi, type Artifact } from '@/api/artifact'
import { toast } from '@/utils/toast'

const props = defineProps<{ componentId: string }>()

const artifacts = ref<Artifact[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const p = await artifactApi.listByComponent(props.componentId, { page: 1, pageSize: 100 })
    artifacts.value = p.items
  } finally {
    loading.value = false
  }
})

async function download(a: Artifact) {
  const url = await artifactApi.getDownloadUrl(a.id)
  window.open(url, '_blank')
}

async function remove(a: Artifact) {
  await artifactApi.remove(a.id)
  toast.ok('制品已删除')
  artifacts.value = artifacts.value.filter((x) => x.id !== a.id)
}

function fmtSize(bytes?: number) {
  if (!bytes) return '—'
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}
</script>

<template>
  <div class="card flush">
    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="artifacts.length === 0" class="empty">该组件下暂无制品</div>
    <table v-else class="table">
      <thead><tr><th>版本</th><th>类型</th><th>大小</th><th>Commit</th><th>创建时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="a in artifacts" :key="a.id">
          <td class="mono"><b>{{ a.version }}</b></td>
          <td><span class="chip">{{ a.artifactType }}</span></td>
          <td>{{ fmtSize(a.sizeBytes) }}</td>
          <td class="mono">{{ a.commitSha?.slice(0, 7) || '—' }}</td>
          <td class="mono">{{ new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
          <td style="white-space: nowrap">
            <a @click="download(a)">下载</a> ·
            <a style="color: var(--failed-fg)" @click="remove(a)">删除</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
