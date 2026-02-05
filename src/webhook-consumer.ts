/**
 * Webhook Queue Consumer
 * 
 * Dispatches webhook notifications to external systems when data changes.
 * Uses Cloudflare Queue for reliable delivery with retry logic.
 */

export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { webhookUrl, event, data, headers } = message.body;
        
        console.log(`Dispatching webhook to ${webhookUrl} for event ${event}`);
        
        // Send POST request to webhook URL
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NanoTypeDB-Webhook/1.0',
            ...(headers || {})
          },
          body: JSON.stringify({
            event,
            data,
            timestamp: new Date().toISOString()
          })
        });
        
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
        }
        
        console.log(`Webhook delivered successfully to ${webhookUrl}`);
        message.ack();
        
      } catch (error: any) {
        console.error(`Failed to deliver webhook:`, error);
        
        // Retry the message (will go to DLQ after max retries)
        message.retry();
      }
    }
  }
};
