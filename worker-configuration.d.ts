import { DurableObjectNamespace, R2Bucket } from "cloudflare:workers";

declare global {
	interface Env {
		DATA_STORE: DurableObjectNamespace;
		BACKUP_BUCKET: R2Bucket;
	}
}
