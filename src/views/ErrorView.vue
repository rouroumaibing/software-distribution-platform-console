<script setup lang="ts">
// 全局错误态（STATUS #21 / CONSOLE-UI-GAPS §3.4）：403 Forbidden 与 404 NotFound。
// 同一版式两种语义，避免为一次性页面各造一个视图。404 由 router catch-all 进入；
// 403 由 http 响应拦截器统一跳转（api/http.ts），也可 <router-link> 直达。
// 「平台管理入口按权限降级隐藏」属产品决策（STATUS #21 拍板项），此处不做。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps<{ kind: 'forbidden' | 'not-found' }>()

const route = useRoute()
const router = useRouter()

const copy = computed(() =>
  props.kind === 'forbidden'
    ? { code: '403', title: '没有访问权限', sub: '你的账号未被授予该资源的权限。如需访问，请联系平台管理员调整角色绑定。' }
    : { code: '404', title: '页面不存在', sub: '链接可能已失效，或资源已被删除。' },
)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/dashboard')
}
</script>

<template>
  <div class="err">
    <div class="code">{{ copy.code }}</div>
    <h1 class="title">{{ copy.title }}</h1>
    <p class="sub">{{ copy.sub }}</p>
    <div class="acts">
      <button class="btn btn-pearl" @click="goBack">返回上一页</button>
      <router-link class="btn btn-primary" to="/dashboard">回总览</router-link>
    </div>
    <p class="mono from" v-if="route.fullPath !== '/'">原始地址：<span>{{ route.fullPath }}</span></p>
  </div>
</template>

<style scoped>
.err {
  max-width: 460px;
  margin: 12vh auto 0;
  text-align: center;
}
.code {
  font-family: var(--mono);
  font-size: 64px;
  font-weight: 700;
  color: var(--text-sub);
  letter-spacing: 0.04em;
}
.title {
  font-size: 20px;
  margin: 10px 0 6px;
}
.sub {
  color: var(--text-sub);
  font-size: 13.5px;
  line-height: 1.6;
}
.acts {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 22px;
}
.from {
  margin-top: 26px;
  font-size: 11.5px;
  color: var(--text-sub);
  word-break: break-all;
}
</style>
