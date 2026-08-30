# Mmap — статическая панель, отдаётся nginx. Сборка не требуется.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Mmap" \
      org.opencontainers.image.description="Crypto wallet transfer map dashboard" \
      org.opencontainers.image.source="https://github.com/SpecFlowdev/Mmap"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY assets /usr/share/nginx/html/assets

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
