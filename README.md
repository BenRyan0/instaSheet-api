# Instantly GoogleSheets Backend

## Overview
This backend powers lead management, campaign automation, and AI-driven email parsing for Instantly and Google Sheets workflows. It integrates with multiple external APIs, supports real-time updates via Socket.IO, and uses PostgreSQL and Redis for persistence and deduplication.

## Features
- REST API for lead, campaign, and email management
- Real-time updates via Socket.IO
- Google Sheets integration
- AI-powered email reply extraction (OpenRouter, Instantly.ai)
- Deduplication and state management with Redis
- PostgreSQL for persistent storage
- Modular service/controller architecture

## Tech Stack
- Node.js (18+ recommended)
- Express.js
- Socket.IO
- PostgreSQL
- Redis
- Zod (env validation)
- Axios, Cheerio, Google APIs
- Third-party APIs: Instantly.ai, OpenRouter, SerpApi, ScrapingRobot

## Getting Started

### 1. Clone the repository
```powershell
# Windows PowerShell
git clone <your-repo-url>
cd instantly-googleSheets
```

### 2. Install dependencies
```powershell
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in required values:
```powershell
cp .env.example .env
```
Refer to `env.js` for all required variables. Key ones:
- `PORT` - Server port
- `MODE` - `dev` or `prod`
- `JWT_SECRET`, `SECRET` - Auth secrets
- `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DB`, `PG_PORT` - PostgreSQL config
- `REDIS_ENV`, `REDIS_URL` or cloud Redis vars
- API keys for Instantly, OpenRouter, SerpApi, ScrapingRobot, etc.

### 4. Run locally (dev mode)
```powershell
npm run dev
```

### 5. Run with Docker Compose (recommended for Windows)
```powershell
docker compose up -d
```
This will start Redis, Postgres, and the backend. See `docker-compose.yml` for details.

### 6. API Endpoints
All routes are prefixed with `/api`:
- `/api/auth` - Authentication
- `/api/spreedsheet` - Google Sheets operations
- `/api/isUsBased` - US-based detection
- `/api/instantlyAi` - AI-powered endpoints
- `/api/logger` - Logging

### 7. Real-time Events
Socket.IO is initialized on server startup. Connect to the same port as the HTTP server for real-time updates.

## Development Notes
- Environment validation uses Zod (`env.js`). The server will exit if required variables are missing.
- Redis is required for deduplication and state. If not available, app will log errors and may not function fully.
- PostgreSQL is required for persistent storage.
- All API keys/secrets should be kept secure and never logged.

## Testing
- No tests are present by default. Add tests using `vitest` (already in devDependencies).

## Linting & Formatting
- Recommended: Add ESLint and Prettier for code quality.

## Deployment
- Use Docker Compose for local dev and testing.
- For production, set all secrets via environment variables or secret manager.
- Ensure Redis and PostgreSQL are available and reachable.
- Use a process manager (PM2) or container orchestration for reliability.

## Troubleshooting
- **Redis errors**: Ensure Redis is running locally or configure cloud Redis in `.env`.
- **Postgres errors**: Ensure DB is running and credentials are correct.
- **Missing env vars**: Check `.env` and `env.js` for required keys.
- **API key errors**: Ensure all third-party API keys are set and valid.

## License
ISC

## Author
BenRyan0
