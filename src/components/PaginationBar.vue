<script setup lang="ts">
// 分页条：配合后端 { items, total, page, pageSize } 分页结构。
import { computed } from 'vue'

const props = defineProps<{ total: number; page: number; pageSize: number }>()
const emit = defineEmits<{ change: [page: number] }>()

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
</script>

<template>
  <div class="pager" v-if="pages > 1">
    <button class="btn btn-pearl btn-sm" :disabled="page <= 1" @click="emit('change', page - 1)">‹ 上一页</button>
    <span class="info">{{ page }} / {{ pages }}（共 {{ total }} 条）</span>
    <button class="btn btn-pearl btn-sm" :disabled="page >= pages" @click="emit('change', page + 1)">下一页 ›</button>
  </div>
</template>

<style scoped>
.pager { display: flex; align-items: center; gap: 12px; justify-content: flex-end; padding: 12px 4px; }
.info { font-size: 12px; color: var(--sub); }
</style>
