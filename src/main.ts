import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initTheme } from './composables/useTheme'
import './styles/tokens.css'

// 主题必须在 mount 之前就绪：index.html 的内联脚本已防住白闪，这里把同一份
// 取值同步进 JS 状态（并对齐 localStorage / 系统偏好），避免模板里读到默认值。
initTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
