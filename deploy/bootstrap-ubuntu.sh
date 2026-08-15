#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vbnmzxc9513/lucky_happy.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/lucky-horse}"
APP_USER="${APP_USER:-luckyhorse}"
PORT="${PORT:-3000}"
ADMIN_USER="${ADMIN_USER:-admin}"
SERVER_NAME="${SERVER_NAME:-_}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if [[ -z "${ADMIN_PASS:-}" ]]; then
  echo "Set ADMIN_PASS before running, for example:"
  echo "ADMIN_PASS='your-strong-password' bash deploy/bootstrap-ubuntu.sh"
  exit 1
fi

escape_systemd_env() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  nginx \
  ufw \
  build-essential \
  python3 \
  make \
  g++ \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

mkdir -p "${APP_DIR}"

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${APP_DIR:?}/"*
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

cd "${APP_DIR}"
runuser -u "${APP_USER}" -- npm ci --omit=dev

{
  printf 'NODE_ENV=production\n'
  printf 'PORT=%s\n' "${PORT}"
  printf 'ADMIN_USER=%s\n' "$(escape_systemd_env "${ADMIN_USER}")"
  printf 'ADMIN_PASS=%s\n' "$(escape_systemd_env "${ADMIN_PASS}")"
} > /etc/lucky-horse.env
chmod 600 /etc/lucky-horse.env
chown root:root /etc/lucky-horse.env

sed \
  -e "s/User=luckyhorse/User=${APP_USER}/" \
  -e "s/Group=luckyhorse/Group=${APP_USER}/" \
  -e "s|WorkingDirectory=/opt/lucky-horse|WorkingDirectory=${APP_DIR}|" \
  deploy/lucky-horse.service > /etc/systemd/system/lucky-horse.service

sed \
  -e "s/server_name _;/server_name ${SERVER_NAME};/" \
  -e "s/proxy_pass http:\/\/127.0.0.1:3000;/proxy_pass http:\/\/127.0.0.1:${PORT};/" \
  deploy/lucky-horse.nginx > /etc/nginx/sites-available/lucky-horse

ln -sf /etc/nginx/sites-available/lucky-horse /etc/nginx/sites-enabled/lucky-horse
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable --now lucky-horse
systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

systemctl --no-pager --full status lucky-horse || true

PUBLIC_IP="$(curl -4fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "Lucky Horse is deployed."
echo "Host:  http://${PUBLIC_IP}/host"
echo "Guest: http://${PUBLIC_IP}/guest"
echo "Admin: http://${PUBLIC_IP}/admin"
