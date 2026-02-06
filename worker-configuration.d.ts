import { DurableObjectNamespace, R2Bucket, D1Database, VectorizeIndex, Ai, Queue } from "cloudflare:workers";
import { DurableObjectNamespace, R2Bucket, D1Database, VectorizeIndex, Ai, Queue, AnalyticsEngineDataset } from "cloudflare:workers";

declare global {
	interface Env {
		DATA_STORE: DurableObjectNamespace;
		BACKUP_BUCKET: R2Bucket;
		AUTH_DB: D1Database;
		READ_REPLICA: D1Database;
		BETTER_AUTH_SECRET: string;
        // Standard Cloudflare Rate Limit Binding
        RATE_LIMITER: any;
        // Vector Database
        VECTOR_INDEX: VectorizeIndex;
        // AI Binding
        AI: Ai;
		// Embedding Queue for retry logic
		EMBEDDING_QUEUE: Queue;
		// Analytics Engine for observability
		ANALYTICS: AnalyticsEngineDataset;
		// Static Assets Binding (Legacy Worker Sites)
		__STATIC_CONTENT: KVNamespace;
		// Cloudflare Queues
		AI_EMBEDDING_QUEUE: Queue;
		WEBHOOK_QUEUE: Queue;
		// Analytics Engine
		ANALYTICS: AnalyticsEngineDataset;
		// Webhook Queue
		WEBHOOK_QUEUE: Queue;
	}
}
