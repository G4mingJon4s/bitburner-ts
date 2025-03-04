import type { ServerWebSocket } from "bun";
import z from "zod";
import { MessageSchemas, type MessageRequest } from "./methods";

export class Remote {
  static timeout = 10_000;

  ws: ServerWebSocket<unknown>;
  id = 0;

  callbacks: Map<number, (res: unknown) => unknown> = new Map();

  constructor(ws: ServerWebSocket<unknown>) {
    this.ws = ws;
  }

  async makeRequest<M extends keyof MessageSchemas>(request: MessageRequest<M>): Promise<
    | { success: false }
    | { success: true, result: z.infer<MessageSchemas[M]["response"]> }
  > {
    const schema = MessageSchemas[request.method as M];

    const id = this.id++;
    this.ws.send(JSON.stringify({
      ...schema.request.parse(request),
      id,
    }));

    let value: { success: false } | { success: true, result: z.infer<MessageSchemas[M]["response"]> } | null = null;
    this.callbacks.set(id, response => {
      this.callbacks.delete(id);

      const result = schema.response.safeParse(response);
      if (!result.success) {
        value = { success: false };
        return;
      }

      value = {
        success: true,
        result: result.data,
      };
    });

    const start = Date.now();
    while (Date.now() - start < Remote.timeout && value === null) {
      await new Promise(res => setTimeout(res, 10));
    }

    if (value === null) this.callbacks.delete(id);
    return value ?? { success: false };
  }
}