/**
 * AI Embedding Queue Consumer
 * 
 * Processes AI embedding tasks from Cloudflare Queue with automatic retry logic.
 * This ensures vector embeddings are eventually consistent even if the AI service
 * times out or rate limits.
 */

export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { taskId, title, doId, timestamp } = message.body;
        
        console.log(`Processing embedding for task ${taskId} from DO ${doId}`);
        
        // Generate embedding using Cloudflare AI
        if (!env.AI || !env.VECTOR_INDEX) {
          console.error("AI or VECTOR_INDEX not configured");
          message.ack();
          continue;
        }
        
        const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', { 
          text: [title] 
        });
        
        const values = embeddings.data[0];
        
        if (!values) {
          console.error(`No embeddings generated for task ${taskId}`);
          message.retry();
          continue;
        }
        
        // Store in vector index
        await env.VECTOR_INDEX.upsert([{
          id: `${doId}:${taskId}`,
          values,
          metadata: { doId, taskId, timestamp }
        }]);
        
        console.log(`Successfully indexed task ${taskId}`);
        
        // Update task status in Durable Object
        // Note: We need to get the DO stub and call an update method
        const doStub = env.DATA_STORE.get(env.DATA_STORE.idFromString(doId));
        await doStub.fetch(new Request(`https://do.internal/update-vector-status`, {
          method: 'POST',
          body: JSON.stringify({ taskId, status: 'indexed' })
        }));
        
        // Acknowledge message on success
        message.ack();
        
      } catch (error: any) {
        console.error(`Failed to process embedding:`, error);
        
        // Retry the message (will go to DLQ after max retries)
        message.retry();
      }
    }
  }
};
