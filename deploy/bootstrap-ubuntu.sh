#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vbnmzxc9513/lucky_happy.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/lucky-horse}"
APP_USER="${APP_USER:-luckyhorse}"
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-}"
STAFF_ACCESS_CODE="${STAFF_ACCESS_CODE:-1009}"
STAFF_SESSION_SECRET="${STAFF_SESSION_SECRET:-}"
RUN_TESTS="${RUN_TESTS:-1}"
SKIP_PUBLIC_CHECK="${SKIP_PUBLIC_CHECK:-0}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "${DOMAIN}" != *.* ]]; then
  echo "Set DOMAIN to the public host name, for example:"
  echo "DOMAIN=game.example.com bash deploy/bootstrap-ubuntu.sh"
  exit 1
fi

if [[ ! "${STAFF_ACCESS_CODE}" =~ ^[0-9]{4,12}$ ]]; then
  echo "STAFF_ACCESS_CODE must contain 4 to 12 digits."
  exit 1
fi

if [[ ! "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "PORT must be between 1024 and 65535."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  apt-transport-https \
  build-essential \
  ca-certificates \
  curl \
  debian-archive-keyring \
  debian-keyring \
  git \
  gnupg \
  libcairo2-dev \
  libgif-dev \
  libjpeg-dev \
  libpango1.0-dev \
  librsvg2-dev \
  openssl \
  ufw

if [[ -z "${STAFF_SESSION_SECRET}" && -f /etc/lucky-horse.env ]]; then
  STAFF_SESSION_SECRET="$(sed -n 's/^STAFF_SESSION_SECRET=//p' /etc/lucky-horse.env | head -n 1)"
fi
if [[ -z "${STAFF_SESSION_SECRET}" ]]; then
  STAFF_SESSION_SECRET="$(openssl rand -hex 32)"
fi
if (( ${#STAFF_SESSION_SECRET} < 32 )); then
  echo "STAFF_SESSION_SECRET must contain at least 32 characters."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  rm -f /tmp/nodesource_setup.sh
fi

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

if [[ -d "${APP_DIR}/.git" ]]; then
  runuser -u "${APP_USER}" -- git -C "${APP_DIR}" fetch origin "${BRANCH}"
  runuser -u "${APP_USER}" -- git -C "${APP_DIR}" checkout "${BRANCH}"
  runuser -u "${APP_USER}" -- git -C "${APP_DIR}" merge --ff-only "origin/${BRANCH}"
else
  if [[ -e "${APP_DIR}" ]] && [[ -n "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "${APP_DIR} exists and is not an empty Git checkout. Move it aside before deploying."
    exit 1
  fi
  install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"
  runuser -u "${APP_USER}" -- git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
runuser -u "${APP_USER}" -- npm ci
runuser -u "${APP_USER}" -- npm run security:check
if [[ "${RUN_TESTS}" == "1" ]]; then
  runuser -u "${APP_USER}" -- npm test
fi

umask 077
cat > /etc/lucky-horse.env <<EOF
NODE_ENV=production
PORT=${PORT}
PUBLIC_BASE_URL=https://${DOMAIN}
STAFF_ACCESS_CODE=${STAFF_ACCESS_CODE}
STAFF_SESSION_SECRET=${STAFF_SESSION_SECRET}
EOF
chown root:root /etc/lucky-horse.env
chmod 600 /etc/lucky-horse.env

sed \
  -e "s|User=luckyhorse|User=${APP_USER}|" \
  -e "s|Group=luckyhorse|Group=${APP_USER}|" \
  -e "s|WorkingDirectory=/opt/lucky-horse|WorkingDirectory=${APP_DIR}|" \
  -e "s|ReadWritePaths=/opt/lucky-horse/data|ReadWritePaths=${APP_DIR}/data|" \
  deploy/lucky-horse.service > /etc/systemd/system/lucky-horse.service

sed \
  -e "s|__DOMAIN__|${DOMAIN}|g" \
  -e "s|__PORT__|${PORT}|g" \
  deploy/Caddyfile.example > /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile

env \
  NODE_ENV=production \
  PORT="${PORT}" \
  PUBLIC_BASE_URL="https://${DOMAIN}" \
  STAFF_ACCESS_CODE="${STAFF_ACCESS_CODE}" \
  STAFF_SESSION_SECRET="${STAFF_SESSION_SECRET}" \
  node -e "require('./server/config'); console.log('Production environment is valid.')"

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable --now lucky-horse
systemctl enable caddy
systemctl reload-or-restart caddy

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null

if [[ "${SKIP_PUBLIC_CHECK}" != "1" ]]; then
  for _ in {1..24}; do
    if curl -fsS "https://${DOMAIN}/healthz" >/dev/null; then
      break
    fi
    sleep 5
  done
  curl -fsS "https://${DOMAIN}/healthz" >/dev/null
  runuser -u "${APP_USER}" -- env STAFF_ACCESS_CODE="${STAFF_ACCESS_CODE}" \
    npm run preflight -- --url "https://${DOMAIN}"
fi

echo
echo "Lucky Horse deployment is healthy."
echo "Guest:   https://${DOMAIN}/guest/"
echo "Host:    https://${DOMAIN}/host/"
echo "Control: https://${DOMAIN}/control/"
echo "Manage:  https://${DOMAIN}/manage"
