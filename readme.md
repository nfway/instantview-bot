# InstantView Bot

[中文](README.zh-CN.md)

This bot generates Instant View links in Telegram.

This version is designed for `one or more users`:

- No MongoDB required
- No RabbitMQ required
- Local JSON cache and state are stored in `.conf/state.json`
- Uses a single-process serial queue
- Supports single-user or multi-user access control

## Features

- [x] Extract redirected links such as amp, clck, and bit.ly
- [x] Create IV from a full article link
- [x] Compress article content
- [x] Split long content into multiple Telegraph pages
- [x] Queue tasks in a single process
- [x] Cache IV results locally
- [ ] Better image parsing
- [ ] Better multi-link handling

## Environment Variables

Required:

- `TBTKN`: Telegram Bot Token
- `TGADMIN`: Telegram admin user ID
- `TGPHTOKEN_0`: Telegraph access token (get your token via: `https://api.telegra.ph/createAccount?short_name=yourBot&author_name=TempMailBot`)

Access control:

- `ALLOWED_USER_IDS`: Comma-separated Telegram user IDs allowed to use the bot
- `SINGLE_USER_ID`: Legacy single-user fallback, used only when `ALLOWED_USER_IDS` is empty

Priority:

- `ALLOWED_USER_IDS` > `SINGLE_USER_ID` > `TGADMIN`

Optional:

- `DEV=1`: Enable debug logs
- `BOT_USERNAME`: Bot username without `@`
- `HELP_MESSAGE`: Extra message when parsing fails
- `NO_PUPPET=1`: Disable Puppeteer fallback
- `NO_PARSE=1`: Disable parsing flow
- `IV_MAKING_TIMEOUT=60`: IV creation timeout in seconds
- `TGGROUP`: Log group ID
- `TGGROUPBUGS`: Error log group ID

See the full example:

- [.env.sample](.env.sample)

## Local Run

```bash
cp .env.sample .env
npm install
npm start
```

## Docker Compose

```bash
cp .env.sample .env
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f
```

Restart or redeploy:

```bash
docker compose restart
docker compose up -d --build
```

Notes:

- `.conf` persists bot config, blacklist, and cached state
- `.docs` persists temporary runtime documents
- The container no longer runs `pm2 restart` or `git pull`; redeploy from the host with Docker Compose instead
