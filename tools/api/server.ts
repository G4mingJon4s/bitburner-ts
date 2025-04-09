import { updateDefinitionFile } from "../files/definitions";
import { storeSaveFile } from "../files/savefiles";
import { MessageAnyResponse } from "./methods";
import { Remote } from "./remote";

let connection: Remote | null = null;
export const getRemote = () => connection;

export const ConnectionTarget = new EventTarget();

export const createEndpoint = (port: number) => Bun.serve({
  port,
  websocket: {
    open: async ws => {
      if (connection !== null) connection.ws.close(1000, "Connected to another client");
      connection = new Remote(ws);

      const defResponse = await connection.makeRequest({
        method: "getDefinitionFile",
      });
      if (!defResponse.success) {
        console.error("Connection failed! Couldn't fetch the definition file.");
        return ws.close(1011, "Bad definitions sync");
      }

      await updateDefinitionFile(defResponse.result);

      ConnectionTarget.dispatchEvent(new Event("connect"));

      const saveResponse = await connection.makeRequest({
        method: "getSaveFile",
      });
      if (!saveResponse.success) {
        console.warn("The RFA Endpoint doesn't support save file sync!");
        return;
      }

      await storeSaveFile(saveResponse.result);
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