# syntax=docker/dockerfile:1
# GO Account web — Vite build → nginx (unprivileged, uid 101, port 8080)
#   - SPA fallback, security headers (CSP), cache ของ assets ที่มี hash
#   - /api/* reverse proxy ไป go-account-api ⇒ หน้าเว็บกับ API เป็น origin เดียวกัน: cookie __Host-/Secure + SameSite=Strict ใช้ได้
# build:  docker build -t go-account-web .   (VITE_DATA_MODE=api เป็นค่า default ของ image)
# run:    GA_API_UPSTREAM=http://api:8080 GA_PUBLIC_SCHEME=https (ดู deploy/nginx/default.conf.template)

FROM node:20.18.1-alpine AS build
WORKDIR /app
ENV CI=true
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY . .
ARG VITE_DATA_MODE=api
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_DATA_MODE=${VITE_DATA_MODE} VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN yarn build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="go-account-web" \
      org.opencontainers.image.description="GO Account web (Vite + React) on nginx" \
      org.opencontainers.image.vendor="GoAlong"
# แทนค่าเฉพาะตัวแปร GA_* ใน template (ตัวแปรของ nginx เช่น $uri ไม่ถูกแตะ)
ENV NGINX_ENVSUBST_FILTER="^GA_" \
    GA_API_UPSTREAM=http://api:8080 \
    GA_PUBLIC_SCHEME=https \
    GA_TRUSTED_PROXY_CIDR=127.0.0.1/32 \
    GA_REAL_IP_HEADER=X-Forwarded-For \
    GA_MAX_BODY=10m
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
