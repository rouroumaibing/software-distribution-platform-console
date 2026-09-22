<script setup lang="ts">
// 应用外壳：router-view + 全局浮层（⌘K 搜索）+ 全局 toast。
// ⌘K 浮层挂在这里而不是 MainLayout：它是**应用级**能力（§5.3 定位为"替代树里翻的主路径"），
// 不该依赖某个布局组件是否渲染；快捷键监听同理，在这里装一次即可。
import { onBeforeUnmount, onMounted } from 'vue'
import CommandPalette from '@/components/CommandPalette.vue'
import { installPaletteShortcut } from '@/composables/useGlobalSearch'
import { toasts } from '@/utils/toast'

let uninstallShortcut: (() => void) | undefined

onMounted(() => {
  uninstallShortcut = installPaletteShortcut()
})

onBeforeUnmount(() => {
  uninstallShortcut?.()
})
</script>

<template>
  <router-view />
  <CommandPalette />
  <div class="toast-host">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.kind === 'error' }">
      {{ t.text }}
    </div>
  </div>
</template>
