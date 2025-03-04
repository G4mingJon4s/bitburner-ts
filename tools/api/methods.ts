import { z } from "zod";

export const MessageSchemas = {
  pushFile: {
    request: z.object({
      method: z.literal("pushFile"),
      params: z.object({
        filename: z.string(),
        server: z.string(),
        content: z.string(),
      }),
    }),
    response: z.literal("OK"),
  },
  getFile: {
    request: z.object({
      method: z.literal("getFile"),
      params: z.object({
        filename: z.string(),
        server: z.string(),
      }),
    }),
    response: z.string(),
  },
  deleteFile: {
    request: z.object({
      method: z.literal("deleteFile"),
      params: z.object({
        filename: z.string(),
        server: z.string(),
      }),
    }),
    response: z.literal("OK"),
  },
  getFileNames: {
    request: z.object({
      method: z.literal("getFileNames"),
      params: z.object({
        server: z.string(),
      }),
    }),
    response: z.array(z.string()),
  },
  getAllFiles: {
    request: z.object({
      method: z.literal("getAllFiles"),
      params: z.object({
        server: z.string(),
      }),
    }),
    response: z.array(
      z.object({
        filename: z.string(),
        content: z.string(),
      })
    ),
  },
  calculateRam: {
    request: z.object({
      method: z.literal("calculateRam"),
      params: z.object({
        filename: z.string(),
        server: z.string(),
      }),
    }),
    response: z.number(),
  },
  getDefinitionFile: {
    request: z.object({
      method: z.literal("getDefinitionFile"),
    }),
    response: z.string(),
  },
  getAllServers: {
    request: z.object({
      method: z.literal("getAllServers"),
    }),
    response: z.array(
      z.object({
        hostname: z.string(),
        hasAdminRights: z.boolean(),
        purchasedByPlayer: z.boolean(),
      })
    ),
  },
} as const;
export type MessageSchemas = typeof MessageSchemas;
export type MessageRequest<M extends keyof MessageSchemas> = { method: M } & Omit<z.infer<MessageSchemas[M]["request"]>, "method">;

export const MessageAnyResponse = z.object({
  id: z.number(),
  result: z.unknown(),
});