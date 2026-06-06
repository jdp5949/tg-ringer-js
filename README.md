# tg-ringer (Node / TypeScript)

Ring (call) and message any Telegram user from **your own account** — a
[GramJS](https://github.com/gram-js/gramjs) userbot for urgent alerts. Placing a
private Telegram call makes the target's phone **ring** (no audio — the ring is the
alert), then hangs up. Node/TS port of [tg-ringer](https://github.com/jdp5949/tg-ringer).

> Userbot = Telegram **ToS gray area**; accounts (esp. VoIP numbers) can be banned.
> Use a throwaway account, mutual contacts, low volume. **Call feature is beta in
> this port** (mirrors the verified Python logic).

## Install

From the GitHub repo:

```bash
npm install github:jdp5949/tg-ringer-js
```

Or download the tarball from [Releases](https://github.com/jdp5949/tg-ringer-js/releases)
and:

```bash
npm install ./tg-ringer-0.1.0.tgz
```

## CLI

```bash
npx tg-ringer login              # interactive setup (api_id/api_hash) + sign in
npx tg-ringer call +15551234567  # ring a number
npx tg-ringer call @user 30      # ring for 30s
npx tg-ringer msg  +15551234567 deploy finished
npx tg-ringer whoami
npx tg-ringer config
```

Get `api_id` / `api_hash` at <https://my.telegram.org>. The login code arrives
**inside Telegram** (the "Telegram" service chat), not SMS. Use a **separate**
account as the userbot — you can't call yourself. Config + session are saved to
`~/.config/tg-ringer-js/config` (chmod 600).

## Library

```ts
import { TgRinger } from "tg-ringer";

const r = new TgRinger({ apiId, apiHash, session });
await r.connect();
await r.ring("+15551234567", 20);     // phone rings 20s
await r.message("+15551234567", "heads up");
await r.disconnect();
```

## License

MIT © jdp5949
