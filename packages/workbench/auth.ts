import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const SESSION_SECONDS = 365 * 24 * 60 * 60;
export const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Local authentication only. Persisted separately from project exports and model credentials. */
export class WorkbenchAuth {
  constructor(readonly token = randomBytes(32).toString("hex")) {}

  static async load(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "auth.json");
    try {
      await writeFile(
        file,
        JSON.stringify({ version: 1, token: randomBytes(32).toString("hex") }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await chmod(file, 0o600);
    const stored = z
      .object({
        version: z.literal(1),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(JSON.parse(await readFile(file, "utf8")));
    return new WorkbenchAuth(stored.token);
  }

  private sign(value: string) {
    return createHmac("sha256", this.token)
      .update(`dreamatic-workbench-session/1:${value}`)
      .digest("hex");
  }

  createSession(now = Date.now()) {
    const payload = `${now + SESSION_SECONDS * 1000}.${randomBytes(16).toString("hex")}`;
    return `${payload}.${this.sign(payload)}`;
  }

  expiresAt(session: string, now = Date.now()): number | undefined {
    const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(session);
    if (!match) return;
    const expires = Number(match[1]);
    if (expires <= now || expires > now + SESSION_SECONDS * 1000) return;
    const expected = Buffer.from(this.sign(`${match[1]}.${match[2]}`), "hex");
    if (!timingSafeEqual(expected, Buffer.from(match[3], "hex"))) return;
    return expires;
  }
}
