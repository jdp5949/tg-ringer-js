#!/usr/bin/env node
/**
 * tg-ringer CLI.
 *
 *   tg-ringer login                interactive setup + sign in
 *   tg-ringer call  TARGET [secs]  ring a user/number, then hang up
 *   tg-ringer msg   TARGET TEXT    send a direct message
 *   tg-ringer whoami               show the logged-in account
 *   tg-ringer config               show current config (api_hash masked)
 *   tg-ringer init                 (re)configure credentials
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { StringSession } from "telegram/sessions";
import { TelegramClient } from "telegram";
import { TgRinger } from "./index";

const CONFIG_DIR =
  process.env.TG_RINGER_HOME || path.join(os.homedir(), ".config", "tg-ringer-js");
const CONFIG_FILE = path.join(CONFIG_DIR, "config");

function loadConfig(): void {
  if (!fs.existsSync(CONFIG_FILE)) return;
  for (const line of fs.readFileSync(CONFIG_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function saveConfig(values: Record<string, string>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing: Record<string, string> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    for (const line of fs.readFileSync(CONFIG_FILE, "utf8").split("\n")) {
      if (line.includes("=") && !line.trim().startsWith("#")) {
        const i = line.indexOf("=");
        existing[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    }
  }
  for (const [k, v] of Object.entries(values)) if (v) existing[k] = v;
  const body =
    "# tg-ringer config — keep private (contains api_hash and session)\n" +
    Object.entries(existing)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n";
  fs.writeFileSync(CONFIG_FILE, body, { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

async function interactiveSetup(): Promise<void> {
  console.log("tg-ringer setup — get api_id/api_hash at https://my.telegram.org\n");
  const apiId = await ask("api_id  : ");
  const apiHash = await ask("api_hash: ");
  const target = await ask("default target (optional, e.g. +15551234567): ");
  if (!apiId || !apiHash) throw new Error("api_id and api_hash are required");
  const vals: Record<string, string> = { TG_API_ID: apiId, TG_API_HASH: apiHash };
  if (target) vals.TG_TARGET = target;
  saveConfig(vals);
  loadConfig();
  console.log(`\nSaved to ${CONFIG_FILE}`);
}

function creds(): { apiId: number; apiHash: string } {
  loadConfig();
  const apiId = process.env.TG_API_ID;
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) {
    console.error("not configured — run `tg-ringer login`");
    process.exit(1);
  }
  return { apiId: Number(apiId), apiHash };
}

function targetOf(arg?: string): string {
  const t = arg || process.env.TG_TARGET;
  if (!t) {
    console.error("no target: pass one or set TG_TARGET");
    process.exit(1);
  }
  return t;
}

async function withRinger<T>(fn: (r: TgRinger) => Promise<T>): Promise<T> {
  const { apiId, apiHash } = creds();
  const r = new TgRinger({ apiId, apiHash, session: process.env.TG_SESSION || "" });
  await r.connect();
  try {
    return await fn(r);
  } finally {
    await r.disconnect();
  }
}

async function cmdLogin(): Promise<void> {
  loadConfig();
  if (!process.env.TG_API_ID || !process.env.TG_API_HASH) await interactiveSetup();
  const { apiId, apiHash } = creds();
  const session = new StringSession(process.env.TG_SESSION || "");
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: () => ask("phone (+E164): "),
    password: () => ask("2FA password: "),
    phoneCode: () => ask("login code (from Telegram app): "),
    onError: (e) => console.error(e),
  });
  saveConfig({ TG_SESSION: client.session.save() as unknown as string });
  const me = (await client.getMe()) as { firstName?: string; id: unknown; username?: string };
  console.log(`Logged in as ${me.firstName} (id ${me.id}, @${me.username})`);
  console.log(`Session saved to ${CONFIG_FILE}`);
  await client.disconnect();
}

function showConfig(): void {
  loadConfig();
  const hash = process.env.TG_API_HASH || "";
  const masked = hash.length > 8 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : "(unset)";
  console.log(`config file : ${CONFIG_FILE} (${fs.existsSync(CONFIG_FILE) ? "exists" : "none"})`);
  console.log(`TG_API_ID   : ${process.env.TG_API_ID || "(unset)"}`);
  console.log(`TG_API_HASH : ${masked}`);
  console.log(`TG_TARGET   : ${process.env.TG_TARGET || "(unset)"}`);
  console.log(`session     : ${process.env.TG_SESSION ? "saved" : "(none)"}`);
}

function usage(): void {
  console.log(`tg-ringer — ring/message Telegram users from your own account

  tg-ringer login                interactive setup + sign in
  tg-ringer call  TARGET [secs]  ring a user/number, then hang up
  tg-ringer msg   TARGET TEXT    send a direct message
  tg-ringer whoami               show the logged-in account
  tg-ringer config               show current config
  tg-ringer init                 (re)configure credentials

TARGET: @username, numeric id, or +E164 phone number.`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "login":
      await cmdLogin();
      break;
    case "init":
      await interactiveSetup();
      break;
    case "config":
      showConfig();
      break;
    case "call": {
      const target = targetOf(rest[0]);
      const secs = rest[1] ? Number(rest[1]) : Number(process.env.RING_SECONDS || 20);
      await withRinger(async (r) => {
        console.log(`ringing ${target} for ${secs}s ...`);
        const id = await r.ring(target, secs);
        console.log(`done (call id ${id})`);
      });
      break;
    }
    case "msg": {
      if (rest.length < 2) throw new Error("usage: tg-ringer msg TARGET TEXT...");
      const target = rest[0];
      const text = rest.slice(1).join(" ");
      await withRinger(async (r) => {
        await r.message(target, text);
        console.log("sent");
      });
      break;
    }
    case "whoami":
      await withRinger(async (r) => {
        const me = await r.whoami();
        console.log(`${me.firstName} (id ${me.id}, @${me.username})`);
      });
      break;
    default:
      usage();
      if (cmd && cmd !== "help" && cmd !== "-h" && cmd !== "--help") process.exit(2);
  }
}

main().catch((e) => {
  console.error("error:", e?.message ?? e);
  process.exit(1);
});
