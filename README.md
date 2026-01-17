# CreateYourShopBot (Cloudflare Production Folder)

This folder deploys **CreateYourShopBot** as a **Cloudflare Worker** + static dashboard.

## What you get
- Telegram bot (webhook) at `/telegram/webhook`
- Dashboard (static) at `/`
- Dashboard API under `/api/*`
- Storage: Cloudflare **D1** (SQL) + **KV** (conversation state)

---

## 0) Requirements
- Cloudflare account
- Node.js on any machine for `wrangler` (PC is easiest). If you only have a phone, you can still do this using Termux + npm.

---

## 1) Create Telegram bot
1. Open **@BotFather**
2. Create a bot (name: `CreateYourShopBot`, username anything available)
3. Copy the token

---

## 2) Install Wrangler
```bash
npm i -g wrangler
```
Login:
```bash
wrangler login
```

---

## 3) Create D1 + KV
```bash
wrangler d1 create createyourshopbot-db
wrangler kv namespace create STATE
wrangler kv namespace create STATE --preview
```

Copy the IDs into `wrangler.toml`:
- `database_id`
- `kv namespace id` and `preview_id`

---

## 4) Run migrations (create tables)
```bash
wrangler d1 execute createyourshopbot-db --file=migrations/0001_init.sql
```

---

## 5) Set secrets
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put APP_BASE_URL
wrangler secret put SUPPORT_USERNAME   # optional
```

`APP_BASE_URL` should be the final deployed URL of this Worker, e.g.
- `https://createyourshopbot.<your-subdomain>.workers.dev`

---

## 6) Deploy
```bash
wrangler deploy
```

---

## 7) Set Telegram webhook
After deploy, set webhook to:

`https://<your-worker-url>/telegram/webhook`

Run:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook"   -H "content-type: application/json"   -d '{"url":"https://<your-worker-url>/telegram/webhook"}'
```

---

## 8) Use it
- Open the bot on Telegram
- Tap **Create store**
- Tap **Link channel** (add the bot as admin in your channel)
- Tap **Add product** (sending a photo in the bot gives you free Telegram-hosted images)
- Tap **Dashboard link** for the web panel

---

## Files you edit
- `wrangler.toml` (put your D1 + KV IDs)
- Secrets via Wrangler (no hardcoding)

## Notes
- Dashboard can add/edit products. For **product images**, easiest is via the bot (Telegram gives a reusable `photo_file_id`).
# Telegramshop
