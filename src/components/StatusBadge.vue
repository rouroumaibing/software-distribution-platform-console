<script setup lang="ts">
// 4 档状态徽章(CONSOLE-DESIGN §2.2)：Succeeded 绿 / Running 蓝 / Failed 红 / Pending 灰。
import { computed } from 'vue'

const props = defineProps<{ phase?: string }>()

const cls = computed(() => {
  switch (props.phase) {
    case 'Succeeded':
      return 'b-succ'
    case 'Running':
      return 'b-run'
    case 'Failed':
      return 'b-fail'
    case 'WaitingApproval':
      return 'b-warn'
    default:
      return 'b-pend'
  }
})

const label = computed(() => props.phase || 'Pending')
</script>

<template>
  <span class="badge" :class="cls"><span class="pt"></span>{{ label }}</span>
</template>
