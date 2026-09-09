<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

onMounted(async () => {
  await auth.handleCallback()
  router.replace('/')
})
</script>

<template>
  <div>正在登录...</div>
</template>
