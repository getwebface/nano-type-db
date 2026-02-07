import { z } from "zod";

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  status: z.enum(["pending", "completed"]).optional(),
  ownerId: z.string().optional(),
}).strict();

export const WebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  secret: z.string().optional(),
  active: z.boolean().optional(),
}).strict();

export const ApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()),
  expiresInDays: z.number().int().positive().optional(),
}).strict();

export const WebSocketMessageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), table: z.string() }),
  z.object({ action: z.literal('unsubscribe'), table: z.string() }),
  z.object({ action: z.literal('create_task'), data: CreateTaskSchema }),
  z.object({ action: z.literal('update_task'), id: z.number(), data: z.object({ title: z.string().optional(), status: z.string().optional() }) }),
  z.object({ action: z.literal('delete_task'), id: z.number() }),
  z.object({ action: z.literal('ping') }),
  
  // New actions supported by the frontend
  z.object({ action: z.literal('subscribe_query'), sql: z.string(), table: z.string().optional() }),
  z.object({ action: z.literal('query'), sql: z.string() }),
  z.object({ action: z.literal('setCursor'), payload: z.object({ userId: z.string(), position: z.any() }) }),
  z.object({ action: z.literal('setPresence'), payload: z.object({ userId: z.string(), status: z.any() }) }),
  z.object({ 
      action: z.literal('rpc'), 
      method: z.string(), 
      payload: z.any().optional(),
      requestId: z.string().optional() 
  }),
]);
