import { connect, createServer } from "node:net";
import { z } from "zod";

/** Playwright's patched Firefox ignores the marionette.port pref and always listens here. */
const MARIONETTE_PORT = 2828;

/** Marionette answers a command with [1, id, error | null, result]. */
const replySchema = z.tuple([z.literal(1), z.number(), z.unknown().nullable(), z.unknown()]);

const installedSchema = z.object({ value: z.string() });

/** Fails loudly if another process already owns Marionette's fixed port, so we never install into a foreign Firefox. */
export async function assertMarionettePortFree(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) =>
      reject(new Error(`Marionette port ${MARIONETTE_PORT} is already in use: ${error.message}`)),
    );
    probe.listen(MARIONETTE_PORT, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

async function session(commands: [string, object][]): Promise<unknown[]> {
  const socket = connect(MARIONETTE_PORT, "127.0.0.1");
  let buffer = "";
  const waiters: ((message: string) => void)[] = [];
  const failed = new Promise<never>((_, reject) => socket.once("error", reject));

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");

    for (;;) {
      const colon = buffer.indexOf(":");
      const length = Number(buffer.slice(0, colon));

      if (colon < 0 || Buffer.byteLength(buffer.slice(colon + 1)) < length) return;
      const message = buffer.slice(colon + 1, colon + 1 + length);
      buffer = buffer.slice(colon + 1 + length);
      waiters.shift()?.(message);
    }
  });

  const next = () =>
    Promise.race([new Promise<string>((resolve) => waiters.push(resolve)), failed]);

  try {
    await next();
    const replies: unknown[] = [];

    for (const [index, [name, params]] of commands.entries()) {
      const json = JSON.stringify([0, index + 1, name, params]);
      const reply = next();
      socket.write(`${Buffer.byteLength(json)}:${json}`);
      const parsed = replySchema.parse(JSON.parse(await reply));

      if (parsed[2] !== null) throw new Error(`${name} failed: ${JSON.stringify(parsed[2])}`);
      replies.push(parsed[3]);
    }

    return replies;
  } finally {
    socket.destroy();
  }
}

/** Installs an unpacked extension as a temporary add-on and returns its Gecko id. */
export async function installTemporaryAddon(path: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const [, installed] = await session([
        ["WebDriver:NewSession", {}],
        ["Addon:Install", { path, temporary: true }],
      ]);

      return installedSchema.parse(installed).value;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Addon:Install failed")) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Marionette never accepted the add-on: ${String(lastError)}`);
}
