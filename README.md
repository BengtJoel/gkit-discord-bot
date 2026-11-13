# GuildKit Bot

En egen MEE6-ersättare som körs på din egen server. Bot, API och dashboard ligger i samma Node-process, och data sparas i Postgres.
Schemat är byggt per `guild_id` så att det kan flyttas in i GuildKit/Supabase senare.

**Moduler:** Levels (samma XP-kurva som MEE6) · Reaction roles · Välkomst/autoroller · Moderering med ärenden, eskalering,
tillfälliga bans och immunitetsroller · Automod · Serverlogg · Egna slash-kommandon · Schemalagda meddelanden ·
"Skapa en kanal" (tillfälliga röstkanaler) · Botprofil per server (namn, bild, banner, bio, färg) · Aktivitetsrapporter (meddelanden, röst, medlemsflöde, heatmap, inaktiva
medlemmar, CSV-export) · Import från MEE6.

**Språk:** engelska och svenska. Botens språk i Discord väljs per server under Inställningar (standard: serverns
Discord-språk). Privata svar följer varje medlems eget Discord-språk. Dashboarden har en egen språkväljare.
Slash-kommandona heter samma sak för alla (`/rank`, `/warn`, `/voice limit`), men beskrivningar och argument visas
på svenska för svenska användare.

## 1. Skapa boten i Discord

1. Gå till <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → Reset Token → kopiera till `DISCORD_TOKEN`.
   Slå på **Server Members Intent** och **Message Content Intent** (krävs för välkomst och automod).
3. **OAuth2** → kopiera *Client ID* och *Client Secret*.
   Lägg till Redirect: `https://<din-domän>/api/auth/callback` (eller `http://localhost:3000/api/auth/callback` lokalt).

## 2. Starta på Ubuntu-servern

```bash
# Docker om du inte har det:  curl -fsSL https://get.docker.com | sh
git clone <repo> guildbot && cd guildbot
cp .env.example .env
nano .env          # fyll i token, client id/secret, PUBLIC_URL, SESSION_SECRET (openssl rand -hex 32), OWNER_IDS
docker compose up -d --build
docker compose logs -f bot
```

Dashboarden lyssnar på `127.0.0.1:3000`. För att nå den utifrån utan att öppna portar i routern:

1. Cloudflare Zero Trust → Networks → Tunnels → skapa en tunnel, public hostname t.ex. `bot.dindomän.se` → `http://bot:3000`
2. Lägg token i `.env` som `CLOUDFLARE_TUNNEL_TOKEN` och kör `docker compose --profile tunnel up -d`
3. Sätt `PUBLIC_URL=https://bot.dindomän.se` och lägg till samma callback-URL i Developer Portal.

Öppna dashboarden, logga in med Discord och klicka på servern för att bjuda in boten. Botens roll måste ligga **ovanför**
de roller den ska dela ut (Serverinställningar → Roller, dra upp den). Dashboarden visar vilka roller den inte kan ge.

## 3. Flytta från MEE6

1. Slå på *Make my server's leaderboard public* i MEE6 → **Importera från MEE6** i dashboarden → Testa → Starta import.
   XP, levels, rollbelöningar och XP-inställningar följer med. Läget "Behåll högsta" går att köra flera gånger.
2. Ställ in välkomst, automod, kommandon och scheman (MEE6 har inget publikt API för dem).
3. Reaction roles: skapa nytt, eller klistra in ID:t på MEE6:s befintliga meddelande så att reaktionerna ligger kvar.
4. Stäng av motsvarande moduler i MEE6, eller kicka MEE6 när allt fungerar.

## Utveckling

```bash
npm install
# Postgres lokalt, t.ex.: docker compose up -d db  (exponera 5432 eller kör egen)
cp .env.example .env   # DATABASE_URL=postgres://guildbot:guildbot@localhost:5432/guildbot
npm run dev:server     # API + bot på :3000 (BOT_ENABLED=false för att köra utan token)
npm run dev:dashboard  # Vite på :5173 med proxy till API:t
npm run db:generate    # efter ändringar i server/src/db/schema.ts → ny migration (körs automatiskt vid start)
```

## Uppgradera

```bash
git pull && docker compose up -d --build
```

Databasmigreringar körs automatiskt vid start. Har du bjudit in boten innan serverloggen fanns: bjud in den igen från
dashboarden (eller ge botens roll *Visa granskningslogg*), annars kan loggen inte visa vem som gjorde en ändring.

## Tester

```bash
npm test   # i18n-paritet, slash-kommandon, automod, levels, mallar, jobbkö (kräver Postgres, annars hoppas den över)
```

## Struktur

```
server/src
  core/          händelsebuss, åtgärdslager (behörighetskontroll + action_log), jobbkö i Postgres
  i18n/          språkfiler (locales/en, locales/sv) som både bot och dashboard använder
  bot/modules/   levels, reactionRoles, welcome, moderation, automod, serverLog, customCommands, timers, tempVoice, activity
  api/           Fastify: Discord-OAuth, behörighet (Hantera server), routes för moduler och rapporter
  mee6/          import via MEE6:s publika leaderboard-endpoint
  settings.ts    zod-scheman + standardvärden för varje moduls inställningar
  db/schema.ts   Drizzle-schema (Postgres)
dashboard/src    React + Vite + Tailwind, en sida per modul
```

Slash-kommandon registreras per server och bara för påslagna moduler, så de uppdateras direkt när du slår på eller av något.

Nya texter läggs i `server/src/i18n/locales/en/*.json` och `sv/*.json`. En nyckel som saknas på engelska ger typfel,
och testerna larmar om svenska och engelska inte har samma nycklar.
Innehållet i meddelanden sparas aldrig. Rapporterna bygger bara på antal per medlem och dag.
