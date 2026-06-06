/**
 * tg-ringer — ring and message any Telegram user from your own account.
 *
 * A GramJS userbot (MTProto, not a bot). Placing a private Telegram call makes
 * the target's phone ring (no audio — the ring is the alert), then hangs up.
 *
 * Port of the Python project: https://github.com/jdp5949/tg-ringer
 * NOTE: the call feature is beta in this port (mirrors the verified Python logic).
 */
import { createHash, randomBytes } from "crypto";
import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

export interface TgRingerOptions {
  apiId: number;
  apiHash: string;
  /** A GramJS string session (empty string for a fresh, not-yet-authorized one). */
  session?: string;
}

export class TgRinger {
  readonly client: TelegramClient;

  constructor(opts: TgRingerOptions) {
    this.client = new TelegramClient(
      new StringSession(opts.session ?? ""),
      opts.apiId,
      opts.apiHash,
      { connectionRetries: 5 },
    );
  }

  /** Connect using the existing session (must already be authorized). */
  async connect(): Promise<void> {
    await this.client.connect();
    if (!(await this.client.isUserAuthorized())) {
      throw new Error("session not authorized — run login first");
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /** Resolve a +phone, @username, or numeric id to an InputUser. */
  async resolve(target: string): Promise<Api.InputUser> {
    if (target.startsWith("+")) {
      const res = (await this.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: bigInt(0),
              phone: target,
              firstName: "alert",
              lastName: "target",
            }),
          ],
        }),
      )) as Api.contacts.ImportedContacts;
      const user = res.users[0] as Api.User | undefined;
      if (!user) throw new Error(`${target} is not on Telegram / not resolvable`);
      return new Api.InputUser({
        userId: user.id,
        accessHash: user.accessHash ?? bigInt(0),
      });
    }
    const entity = await this.client.getEntity(target);
    const anyEnt = entity as unknown as { id: bigInt.BigInteger; accessHash?: bigInt.BigInteger };
    return new Api.InputUser({
      userId: anyEnt.id,
      accessHash: anyEnt.accessHash ?? bigInt(0),
    });
  }

  /** Ring the target's phone for `seconds`, then hang up. Returns the call id. */
  async ring(target: string, seconds = 20): Promise<bigInt.BigInteger> {
    const peer = await this.resolve(target);

    const dh = (await this.client.invoke(
      new Api.messages.GetDhConfig({ version: 0, randomLength: 256 }),
    )) as Api.messages.DhConfig;

    const p = bigInt(dh.p.toString("hex"), 16);
    const g = bigInt(dh.g);
    const a = bigInt(randomBytes(256).toString("hex"), 16).mod(p);
    const gA = g.modPow(a, p);

    // left-pad g_a to 256 bytes before hashing
    let gaHex = gA.toString(16);
    if (gaHex.length % 2) gaHex = "0" + gaHex;
    let gaBuf = Buffer.from(gaHex, "hex");
    if (gaBuf.length < 256) {
      gaBuf = Buffer.concat([Buffer.alloc(256 - gaBuf.length), gaBuf]);
    }
    const gAHash = createHash("sha256").update(gaBuf).digest();

    const res = (await this.client.invoke(
      new Api.phone.RequestCall({
        userId: peer,
        randomId: Math.floor(Math.random() * 2 ** 31),
        gAHash,
        protocol: new Api.PhoneCallProtocol({
          minLayer: 65,
          maxLayer: 92,
          udpP2p: true,
          udpReflector: true,
          libraryVersions: ["4.0.0"],
        }),
      }),
    )) as Api.phone.PhoneCall;

    const call = res.phoneCall as Api.PhoneCallWaiting;
    await new Promise((r) => setTimeout(r, seconds * 1000));

    await this.client.invoke(
      new Api.phone.DiscardCall({
        peer: new Api.InputPhoneCall({ id: call.id, accessHash: call.accessHash }),
        duration: 0,
        reason: new Api.PhoneCallDiscardReasonHangup(),
        connectionId: bigInt(0),
      }),
    );
    return call.id;
  }

  /** Send a direct message to the target. */
  async message(target: string, text: string): Promise<void> {
    const peer = await this.resolve(target);
    await this.client.sendMessage(peer, { message: text });
  }

  /** Return the logged-in account. */
  async whoami(): Promise<Api.User> {
    return (await this.client.getMe()) as Api.User;
  }

  /** Ask @SpamBot for this account's anti-spam status; return its reply. */
  async spamStatus(): Promise<string> {
    await this.client.sendMessage("SpamBot", { message: "/start" });
    await new Promise((r) => setTimeout(r, 3000));
    const msgs = await this.client.getMessages("SpamBot", { limit: 1 });
    return msgs[0]?.message || "(no reply yet — try again in a moment)";
  }
}
