import { DurableObjectNamespace, R2Bucket, D1Database, VectorizeIndex, Ai, Queue } from "cloudflare:workers";

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
		// Static Assets Binding
		ASSETS: Fetcher;
		// Webhook Queue
		WEBHOOK_QUEUE: Queue;
	}
}
