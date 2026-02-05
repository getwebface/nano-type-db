import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
    // automatically infers the base URL from the current window
    baseURL: window.location.origin 
});