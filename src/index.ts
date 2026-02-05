import { DataStore } from "./durable-object";

export { DataStore };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Look for room_id in query params
    const roomId = url.searchParams.get("room_id");

    if (!roomId) {
      return new Response("Missing room_id query parameter", { status: 400 });
    }

    // Get the Durable Object ID from the room name
    const id = env.DATA_STORE.idFromName(roomId);
    
    // Get the stub
    const stub = env.DATA_STORE.get(id);

    // Route websocket upgrades
    if (request.headers.get("Upgrade") === "websocket") {
       const newUrl = new URL(request.url);
       newUrl.pathname = "/connect";
       const newRequest = new Request(newUrl.toString(), request);
       return stub.fetch(newRequest);
    }

    // Route Schema Introspection (REST API)
    if (url.pathname === "/schema") {
        return stub.fetch(request);
    }

    // Forward standard requests (if any)
    return stub.fetch(request);
  },
};
