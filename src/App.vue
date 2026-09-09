<script setup lang="ts">
import { toasts } from '@/utils/toast'
</script>

<template>
  <router-view />
  <div class="toast-host">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.kind === 'error' }">
      {{ t.text }}
    </div>
  </div>
</template>
