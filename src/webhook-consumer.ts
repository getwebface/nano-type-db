/**
 * Webhook Queue Consumer
 * 
 * Dispatches webhook notifications to external systems when data changes.
 * Uses Cloudflare Queue for reliable delivery with retry logic.
 */

import { MessageBatch } from "cloudflare:workers";

interface WebhookMessage {
  webhookId: string;
  url: string;
  secret?: string;
  payload: any;
}

export default {
  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { webhookId, url, payload } = message.body;
      let success = false;
      let statusCode = 0;
      let responseBody = "";

      try {
        console.log(`Dispatching webhook to ${url} for event ${payload.event}`);
        
        // Send POST request to webhook URL
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NanoTypeDB-Webhook/1.0',
            // Sign request if secret exists (HMAC-SHA256 could be added here)
          },
          body: JSON.stringify(payload)
        });
        
        statusCode = response.status;
        success = response.ok;
        
        // Try to get response text for debugging, truncated
        try {
            responseBody = (await response.text()).slice(0, 500);
        } catch {}

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
        }
        
        console.log(`Webhook delivered successfully to ${url}`);
        message.ack(); // Acknowledge success
        
      } catch (error: any) {
        console.error(`Failed to deliver webhook:`, error);
        
        statusCode = statusCode || 0;
        responseBody = error.message || "Network Error";
        
        // Retry the message (will go to DLQ after max retries)
        message.retry();
      } finally {
          // Lazy Migration & Logging to D1
          if (env.READ_REPLICA) {
              try {
                  const now = Date.now();
                  const logId = `whlog_${now}_${Math.random().toString(36).substring(7)}`;
                  
                  await env.READ_REPLICA.prepare(
                    `INSERT INTO _webhook_logs (id, webhook_id, url, event, status_code, success, response, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                  ).bind(logId, webhookId || 'unknown', url, payload.event, statusCode, success ? 1 : 0, responseBody, now)
                  .run();
              } catch (dbErr: any) {
                  // Lazy Migration: Create table if not exists
                  if (dbErr.message?.includes('no such table')) {
                      console.log("Creating _webhook_logs table...");
                      try {
                          await env.READ_REPLICA.exec(`
                              CREATE TABLE IF NOT EXISTS _webhook_logs (
                                  id TEXT PRIMARY KEY,
                                  webhook_id TEXT,
                                  url TEXT,
                                  event TEXT,
                                  status_code INTEGER,
                                  success INTEGER,
                                  response TEXT,
                                  created_at INTEGER
                              );
                              CREATE INDEX IF NOT EXISTS idx_webhook_logs_whid ON _webhook_logs(webhook_id);
                          `);
                          // Retry log insert
                          const now = Date.now();
                          const logId = `whlog_${now}_${Math.random().toString(36).substring(7)}`;
                          await env.READ_REPLICA.prepare(
                            `INSERT INTO _webhook_logs (id, webhook_id, url, event, status_code, success, response, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                          ).bind(logId, webhookId || 'unknown', url, payload.event, statusCode, success ? 1 : 0, responseBody, now)
                          .run();
                      } catch (createErr) {
                          console.error("Failed to create webhook logs table:", createErr);
                      }
                  } else {
                      console.error("Failed to log webhook execution:", dbErr);
                  }
              }
          }
