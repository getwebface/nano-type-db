<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Z_rvYIuwSty1XkzeKDuY_vanU1VE93QC

## Features

- **Real-time Database**: Powered by Cloudflare Durable Objects with WebSocket support
- **Automatic Reconnection**: Smart reconnection logic with exponential backoff
- **Connection Health Monitoring**: Heartbeat/ping-pong to keep connections alive
- **Visual Status Indicators**: Real-time connection status display
- **Better Auth Integration**: Secure authentication with Better Auth

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## WebSocket Connection

For details on the WebSocket connection system and troubleshooting, see [WEBSOCKET_IMPROVEMENTS.md](./WEBSOCKET_IMPROVEMENTS.md).
