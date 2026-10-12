<script setup lang="ts">
// 状态徽章：运行域六相（§2.2）+ Rollout 域七相（ui-12 §4.5 终态扩展）。
// 映射到 tokens.css 的 6 态色板；Unknown/空值一律落 Pending 灰。
import { computed } from 'vue'

const props = defineProps<{ phase?: string }>()

const cls = computed(() => {
  switch (props.phase) {
    case 'Succeeded':
    case 'Healthy':
      return 'b-succ'
    case 'Running':
    case 'Progressing':
    case 'RollingBack':
      return 'b-run'
    case 'Failed':
    case 'Degraded':
      return 'b-fail'
    case 'WaitingApproval':
    case 'Paused':
      return 'b-warn'
    case 'Cancelled':
    case 'RolledBack':
      return 'b-pend'
    default:
      return 'b-pend'
  }
})

const label = computed(() => props.phase || 'Pending')
</script>

<template>
  <span class="badge" :class="cls"><span class="pt"></span>{{ label }}</span>
</template>
