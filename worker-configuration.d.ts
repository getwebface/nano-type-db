import { DurableObjectNamespace } from "cloudflare:workers";

declare global {
	interface Env {
		DATA_STORE: DurableObjectNamespace;
	}
}
