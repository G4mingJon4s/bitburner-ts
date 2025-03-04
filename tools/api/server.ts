import { updateDefinitionFile } from "../files/definitions";
import { MessageAnyResponse } from "./methods";
import { Remote } from "./remote";

let connection: Remote | null = null;
export const getRemote = () => connection;

export const createEndpoint = (port: number) => Bun.serve({
  port,
  websocket: {
    open: async ws => {
      if (connection !== null) connection.ws.close(1000, "Connected to another client");
      connection = new Remote(ws);

      const response = await connection.makeRequest({
        method: "getDefinitionFile",
      });
      if (!response.success) {
        return ws.close(1011, "Bad sync");
      }

      await updateDefinitionFile(response.result);
    },
    message: (_, m) => {
      if (typeof m !== "string") throw new Error("Unsupported message type");

      const parsed = JSON.parse(m);
      const anyRes = MessageAnyResponse.safeParse(parsed);
      if (!anyRes.success) throw new Error("Malformed message");

      const id = anyRes.data.id;
      const callback = connection!.callbacks.get(id);
      if (callback === undefined) throw new Error("Invalid ID");

      callback(anyRes.data.result);
    },
  },
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("Upgrade to WebSocket failed", { status: 426 });
  },
});