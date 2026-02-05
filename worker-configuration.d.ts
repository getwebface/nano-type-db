import { DurableObjectNamespace, R2Bucket, D1Database } from "cloudflare:workers";

declare global {
	interface Env {
		DATA_STORE: DurableObjectNamespace;
		BACKUP_BUCKET: R2Bucket;
		AUTH_DB: D1Database;
		BETTER_AUTH_SECRET: string;
        // Standard Cloudflare Rate Limit Binding
        RATE_LIMITER: any; 
	}
}
