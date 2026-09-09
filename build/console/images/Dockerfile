# software-distribution-platform-console 运行时镜像（对齐 old/go-devops/console 参考工程形态）。
# 由 build/console/build.sh 在 output/console/images/ 内使用。
# 设计原则：镜像只装静态构建产物，保持「纯静态 nginx」——
#   - 不 COPY 任何 nginx 配置 / config.js 模板（运行时配置全部 chart 化，
#     nginx.conf 与 config.js 由 chart 以 ConfigMap 挂载，改配置无需重建镜像）；
#   - 443 TLS 由 chart 预置的证书 secret 提供（挂 /etc/nginx/ssl）。
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/50x.html /usr/share/nginx/html/index.html
ADD console-dist.tar.gz /usr/share/nginx/html
EXPOSE 443 80
CMD ["nginx", "-g", "daemon off;"]
