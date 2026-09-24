# UnabridgedAI

Single-host app: React UI + Express API, one process, one origin.

```
web/        React UI
src/        Express API, SQLite, LLM proxy
prompts/    system prompt
```

The browser talks to `/api` on the same origin. Dev uses Vite as Express middleware (HMR). Production serves `dist/`.

## Setup

```bash
npm install
cp .env.example .env
```

Set `ZERO_ZERO_API_KEY` in `.env`.

## Develop

```bash
npm run dev
```

Open http://localhost:3001.

## Run as one service

```bash
npm run build
npm start
```

## Docker

```bash
cp .env.example .env   # then set keys
docker compose up --build
```

Data lives in the `unabridged-data` volume. The app listens on port 3001.
