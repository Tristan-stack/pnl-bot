# Discord PnL Bot

Bot Discord qui monitore des wallets Solana via GMGN et envoie automatiquement des PnL cards dans un channel quand un trade de vente est detecte.

## Features

- Monitoring automatique de wallets Solana (polling GMGN toutes les 30s)
- Generation d'images PnL card (1200x630 PNG) avec background custom
- Envoi automatique dans un channel Discord a chaque vente
- Commandes slash avec autocomplete pour les wallets
- Nettoyage auto des trades > 15 jours
- Hebergement gratuit sur Fly.io

## Commands

| Command | Description |
|---|---|
| `/wallet add <address> [name]` | Ajouter un wallet au monitoring |
| `/wallet remove <address>` | Retirer un wallet |
| `/wallet rename <address> <name>` | Renommer un wallet |
| `/wallet list` | Lister tous les wallets monitores |
| `/pnl today` | PnL total du jour (tous wallets) |
| `/pnl wallet <address>` | PnL du jour pour un wallet |
| `/pnl card <address>` | Generer une PnL card a la demande |
| `/config channel <#channel>` | Definir le channel de publication |
| `/config background <image>` | Uploader un fond custom pour les cards |

## Setup local

### Prerequis

- Node.js 20+
- npm

### Installation

```bash
npm install
cp .env.example .env
```

Remplir `.env` :

```
DISCORD_TOKEN=ton_token_bot
DISCORD_CLIENT_ID=ton_client_id
GMGN_API_KEY=ta_cle_api_gmgn
DATABASE_URL=file:./dev.db
POLL_INTERVAL_SECONDS=30
DATA_DIR=./data
```

### Obtenir une cle API GMGN

1. Generer une paire de cles Ed25519 :

```bash
openssl genpkey -algorithm ED25519 -out gmgn-ed25519-private.pem
openssl pkey -in gmgn-ed25519-private.pem -pubout -out gmgn-ed25519-public.pem
```

2. Aller sur https://gmgn.ai/ai
3. Uploader le contenu de `gmgn-ed25519-public.pem`
4. Copier l'API Key generee -> `GMGN_API_KEY`

Note : la cle privee n'est pas requise pour ce bot (lecture seule). Ne jamais committer les fichiers `.pem`.

L'API GMGN est limitee a **2 requetes par seconde** ; le bot espace automatiquement les appels (~550 ms). Les champs peuvent evoluer sans preavis. Requetes **IPv4 uniquement** (IPv6 renvoie 403).

### Creer le bot Discord

1. Aller sur https://discord.com/developers/applications
2. Creer une application
3. Section "Bot" : copier le token -> `DISCORD_TOKEN`
4. Section "OAuth2" : copier le Client ID -> `DISCORD_CLIENT_ID`
5. Inviter le bot avec ce lien (remplacer CLIENT_ID) :

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=2048&scope=bot%20applications.commands
```

Permissions requises : `Send Messages`, `Attach Files`.

### Lancer

```bash
npx prisma migrate dev
npm run dev
```

## Deploy sur Fly.io (gratuit)

### Prerequis

```bash
npm install -g flyctl
fly auth login
```

### Premier deploiement

```bash
fly launch
fly volumes create pnl_data --size 1 --region cdg
fly secrets set DISCORD_TOKEN=ton_token DISCORD_CLIENT_ID=ton_client_id GMGN_API_KEY=ta_cle
fly deploy
```

### Mise a jour

```bash
npm run build
fly deploy
```

### Monitoring

```bash
fly logs
fly status
```

## Architecture

```
src/
  commands/       Slash commands (wallet, pnl, config)
  events/         Discord event handlers (ready, interactionCreate)
  services/       Business logic (gmgn, monitor, card)
  db/             Prisma client singleton
  types/          Shared TypeScript types + Zod schemas
  utils/          Formatting helpers
  index.ts        Entry point
```

## Stack

- TypeScript + Node.js 20
- discord.js v14
- Prisma + SQLite
- @napi-rs/canvas (image generation)
- GMGN OpenAPI (wallet activity)
- Fly.io (hosting)

## Pour les contributeurs

Les devs utilisant un assistant IA (Claude Code, OpenClaw, etc.) peuvent installer les skills GMGN pour reference :

```bash
npx skills add GMGNAI/gmgn-skills
```

Note : ceci installe des skills pour l'assistant IA, pas une dependance npm du bot.
