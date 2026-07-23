# Bruno API Collection

Bruno collection for testing the inferr API endpoints.

## Setup

### 1. Install Bruno

Download from [usebruno.com](https://www.usebruno.com)

### 2. Open Collection

1. Open Bruno → **Open Collection** → select this `bruno/` folder

### 3. Select Environment

- **local** — `http://localhost:3001`
- **production** — your Render API URL

### 4. Set Auth Token

After signing in, copy your JWT access token (from `POST /auth/refresh`) and set `authToken` in the environment variables.

---

## Requests

### Health Check
Verify the API is running.
```
GET /health
```

### Google Login
Opens the Google OAuth consent screen. Complete in a browser; the callback sets the `refresh_token` HttpOnly cookie.
```
GET /auth/google
```

### Get Me
Returns the authenticated user's profile and whether they have interests saved.
```
GET /auth/me
Authorization: Bearer {{authToken}}
```

### Run Scraper
Triggers the full ingestion pipeline: fetch metadata → scrape content → summarize + embed. Protected by `SCRAPER_API_KEY`.
```
POST /scraper/run
Authorization: Bearer <SCRAPER_API_KEY>
```

### Get Feed
Returns a personalized, relevance-filtered article feed.

```
GET /feed
Authorization: Bearer {{authToken}}
```

Response shape:
```json
{
  "hasMatches": true,
  "articles": [{ "title", "summary", "url", "source" }],
  "fallback": [{ "title", "summary", "url", "source" }]
}
```
When `hasMatches` is `false`, `articles` is empty and `fallback` contains the top-10 recent articles regardless of relevance.

### Chat
Send a message to the agentic RAG pipeline. Optionally pass conversation history for multi-turn context.

```
POST /chat
Authorization: Bearer {{authToken}}
Body:
{
  "message": "What are the latest trends in TypeScript?",
  "history": [
    { "role": "user", "content": "Tell me about Rust" },
    { "role": "assistant", "content": "Rust is a systems programming language..." }
  ]
}
```

Response shape:
```json
{
  "answer": "...",
  "sources": [{ "title", "url", "source" }]
}
```

Constraints: `message` max 500 chars, `history` max 20 turns, each `content` max 4000 chars.

### Process Summaries
Manually trigger summarization + embedding for articles that have content but no summary yet.
Ops-only — same key as the scraper (not a user JWT).

```
POST /ai/process
Authorization: Bearer {{scraperKey}}
```

---

## Notes

- The scraper and AI process endpoints require `SCRAPER_API_KEY` (not a user JWT). Set it as `scraperKey` in your Bruno environment.
- Chat history `role` must be `"user"` or `"assistant"` — `"system"` is rejected at the API boundary.
- Render's free tier sleeps after inactivity; the first request after a cold start may take ~30s.
