# API Endpoints Documentation

This document describes the API endpoints for managing API keys and webhooks in nanotypeDB.

## API Key Management

### Generate API Key

Create a new API key for accessing the database programmatically.

**Endpoint:** `POST /api/keys/generate`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "name": "string (optional, max 100 chars)",
  "expiresInDays": "number (optional, 1-365, default: 90)",
  "scopes": "array of strings (optional, default: ['read', 'write'])"
}
```

**Valid Scopes:**
- `read` - Read access to database
- `write` - Write access to database
- `admin` - Administrative access

**Response (Success - 200):**
```json
{
  "id": "nk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "My API Key",
  "created_at": 1234567890000,
  "expires_at": 1234567890000,
  "expires_in_days": 90,
  "scopes": ["read", "write"]
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

**Error Cases:**
- `400` - Invalid JSON body, empty key name, invalid expiration days, invalid scopes
- `401` - Not authenticated
- `409` - API key already exists (rare, retry should work)
- `500` - Server error

---

### List API Keys

Get all API keys for the authenticated user.

**Endpoint:** `GET /api/keys/list`

**Authentication:** Required (user session)

**Query Parameters:**
- `includeExpired` (boolean, default: false) - Include expired keys in results
- `limit` (number, 1-100, default: 100) - Maximum number of keys to return
- `offset` (number, default: 0) - Offset for pagination

**Response (Success - 200):**
```json
{
  "keys": [
    {
      "id": "nk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "name": "My API Key",
      "created_at": 1234567890000,
      "last_used_at": 1234567890000,
      "expires_at": 1234567890000,
      "scopes": ["read", "write"],
      "is_expired": false
    }
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "total": 1
  }
}
```

**Response (Error - 401/500):**
```json
{
  "error": "Error message description"
}
```

---

### Delete API Key

Delete an API key. This action cannot be undone.

**Endpoint:** `POST /api/keys/delete`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "id": "nk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "API key deleted successfully"
}
```

**Response (Error - 400/401/404/500):**
```json
{
  "error": "Error message description"
}
```

**Error Cases:**
- `400` - Missing or invalid key ID format
- `401` - Not authenticated
- `404` - Key not found or does not belong to user
- `500` - Server error

---

## Webhook Management

### Create Webhook

Create a new webhook endpoint to receive real-time event notifications.

**Endpoint:** `POST /api/webhooks/create`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "url": "https://example.com/webhook",
  "events": "* (optional, default: '*')",
  "secret": "string (optional, auto-generated if not provided)",
  "active": "boolean (optional, default: true)"
}
```

**Event Pattern Format:**
- `*` - All events
- `table.*` - All events for a specific table
- `*.action` - Specific action across all tables
- `table.action` - Specific table and action
- Multiple patterns: `users.*,posts.created,comments.*`

**Valid Actions:** `created`, `updated`, `deleted`

**Response (Success - 200):**
```json
{
  "success": true,
  "webhook": {
    "id": "wh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "url": "https://example.com/webhook",
    "events": "*",
    "secret": "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "active": true,
    "created_at": 1234567890000,
    "failure_count": 0
  },
  "message": "Webhook configuration prepared. Note: Full integration requires Durable Object setup."
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

**Error Cases:**
- `400` - Missing/invalid URL, invalid event pattern
- `401` - Not authenticated
- `500` - Server error

**Security Notes:**
- HTTPS is strongly recommended for production webhooks
- The `secret` should be used to verify webhook signatures
- Non-HTTPS URLs will generate a warning in logs

---

### List Webhooks

Get all webhooks for a specific room.

**Endpoint:** `GET /api/webhooks/list`

**Authentication:** Required (user session)

**Query Parameters:**
- `room_id` (string, required) - The room/database ID

**Response (Success - 200):**
```json
{
  "webhooks": [],
  "message": "Full webhook listing requires Durable Object integration with room context."
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

---

### Update Webhook

Update an existing webhook configuration.

**Endpoint:** `POST /api/webhooks/update` or `PATCH /api/webhooks/update`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "id": "wh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "url": "https://new-url.com/webhook (optional)",
  "events": "users.*,posts.* (optional)",
  "active": "boolean (optional)"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Webhook update prepared. Full integration requires Durable Object setup."
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

**Error Cases:**
- `400` - Missing webhook ID, invalid URL/event pattern
- `401` - Not authenticated
- `405` - Method not allowed (only POST/PATCH accepted)
- `500` - Server error

---

### Delete Webhook

Delete a webhook endpoint.

**Endpoint:** `POST /api/webhooks/delete` or `DELETE /api/webhooks/delete`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "id": "wh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Webhook deletion prepared. Full integration requires Durable Object setup."
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

---

### Test Webhook

Send a test event to a webhook endpoint to verify it's working.

**Endpoint:** `POST /api/webhooks/test`

**Authentication:** Required (user session)

**Request Body:**
```json
{
  "id": "wh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Test webhook event queued. Check your endpoint for delivery.",
  "payload": {
    "event": "webhook.test",
    "data": {
      "message": "This is a test webhook event",
      "test": true,
      "timestamp": 1234567890000
    },
    "timestamp": 1234567890000
  }
}
```

**Response (Error - 400/401/500):**
```json
{
  "error": "Error message description"
}
```

---

## Common Error Responses

All endpoints return structured JSON error responses:

**Authentication Error (401):**
```json
{
  "error": "Authentication failed. Please refresh and try again."
}
```

**Validation Error (400):**
```json
{
  "error": "Descriptive validation error message"
}
```

**Server Error (500):**
```json
{
  "error": "Failed to [action]: [error details]"
}
```

---

## Security Features

### API Keys
- Automatic expiration (default: 90 days, max: 365 days)
- Scope-based access control
- Secure random generation using `crypto.randomUUID()`
- Audit logging for all key operations
- User isolation (users can only manage their own keys)

### Webhooks
- URL format validation
- HTTPS enforcement (recommended)
- Event pattern validation
- Automatic secret generation for signature verification
- Failure tracking with auto-disable after 10 failures
- Audit logging for all webhook operations

---

## Rate Limiting

API endpoints may be subject to rate limiting. The system uses a sliding window algorithm to prevent abuse. If you encounter rate limiting errors, implement exponential backoff in your client.

---

## Best Practices

### API Keys
1. **Rotate keys regularly** - Generate new keys and delete old ones periodically
2. **Use appropriate scopes** - Only grant the minimum required permissions
3. **Store securely** - Never commit API keys to version control
4. **Monitor usage** - Check `last_used_at` to identify unused keys
5. **Set expiration** - Use the shortest expiration period that works for your use case

### Webhooks
1. **Use HTTPS** - Always use HTTPS URLs in production
2. **Verify signatures** - Use the webhook secret to verify event authenticity
3. **Handle failures gracefully** - Implement retry logic in your webhook endpoint
4. **Monitor failure count** - Webhooks are auto-disabled after 10 consecutive failures
5. **Test before deploying** - Use the test endpoint to verify your webhook works
6. **Use specific event patterns** - Avoid `*` in production to reduce noise

---

## Support

For issues or questions about these API endpoints, please:
1. Check the error message for specific guidance
2. Review the examples in this documentation
3. Check the browser console for detailed error logs
4. Verify your authentication session is valid
