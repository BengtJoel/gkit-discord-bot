#!/usr/bin/env bash
# GuildKit Bot – installation på Ubuntu.
# Kör från repo-mappen:  bash scripts/setup.sh
# Skriptet installerar Docker vid behov, frågar efter Discord-uppgifterna, skapar .env och startar allt.
set -euo pipefail

cd "$(dirname "$0")/.."
bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ask() { # ask VAR "fråga" [standard] [hemlig]
  local __var=$1 __q=$2 __def=${3:-} __secret=${4:-} __val
  local __prompt="$__q"; [ -n "$__def" ] && __prompt="$__q [$__def]"
  if [ -n "$__secret" ]; then read -r -s -p "$__prompt: " __val </dev/tty; echo; else read -r -p "$__prompt: " __val </dev/tty; fi
  printf -v "$__var" '%s' "${__val:-$__def}"
}

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  bold "Installerar Docker…"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" || true
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"; fi
if ! $DOCKER compose version >/dev/null 2>&1; then
  bold "Installerar docker compose-plugin…"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq docker-compose-plugin
fi

# 2. .env
if [ -f .env ]; then
  bold ".env finns redan – behåller den. (Ta bort filen och kör igen för att börja om.)"
else
  bold "Discord-uppgifter (från https://discord.com/developers/applications)"
  ask DISCORD_CLIENT_ID     "Application / Client ID"
  ask DISCORD_CLIENT_SECRET "Client Secret (OAuth2)" "" secret
  ask DISCORD_TOKEN         "Bot Token (Bot → Reset Token)" "" secret
  ask OWNER_IDS             "Ditt Discord-användar-ID (högerklick på dig själv → Kopiera ID)"
  ask PUBLIC_URL            "Adress till dashboarden" "http://localhost:3000"

  SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')

  umask 077
  cat > .env <<EOF
DISCORD_TOKEN=$DISCORD_TOKEN
DISCORD_CLIENT_ID=$DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET
PUBLIC_URL=$PUBLIC_URL
SESSION_SECRET=$SESSION_SECRET
OWNER_IDS=$OWNER_IDS
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
CLOUDFLARE_TUNNEL_TOKEN=
LOG_LEVEL=info
EOF
  echo ".env skapad (bara läsbar för dig)."
fi

# 3. Starta
bold "Bygger och startar (första gången tar det några minuter)…"
$DOCKER compose up -d --build

bold "Väntar på att boten ska svara…"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/health && echo || { echo "Boten svarar inte än. Kolla loggen:  $DOCKER compose logs bot"; exit 1; }

set -a; . ./.env; set +a
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
bold "Klart! 🎉"
cat <<EOF
1. Lägg till denna Redirect under OAuth2 i Developer Portal (om du inte redan gjort det):
     ${PUBLIC_URL%/}/api/auth/callback
2. På din Windows-dator, öppna en NY PowerShell och kör:
     ssh -L 3000:localhost:3000 $USER@${IP:-<serverns-ip>}
   Låt det fönstret vara öppet och gå till  http://localhost:3000
3. Logga in med Discord och bjud in boten till din testserver.

Loggar:      $DOCKER compose logs -f bot
Uppdatera:   git pull && $DOCKER compose up -d --build
Stoppa:      $DOCKER compose down
EOF
