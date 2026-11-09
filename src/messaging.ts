import { replySchema } from "./model.ts";

import type { Reply, Request } from "./model.ts";

export async function send(request: Request): Promise<Reply> {
  const response = await chrome.runtime.sendMessage(request);
  const parsed = replySchema.safeParse(response);

  if (!parsed.success) throw new Error("The extension background did not accept the request.");

  return parsed.data;
}
