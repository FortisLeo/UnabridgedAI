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


## OpenAI-compatible API

Create named keys in the app under **Get API**. Then point any OpenAI client at this origin:

```
base URL:  http://localhost:3001/v1
API key:   uai_...
```

Open WebUI: Admin → Connections → OpenAI → API URL `http://HOST:3001/v1`, paste a key.

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3001/v1", api_key="uai_...")
print(client.chat.completions.create(
    model="unabridged",
    messages=[{"role": "user", "content": "Hello."}],
).choices[0].message.content)
```

The UnabridgedAI system prompt is always prepended. Extra `system` messages from the client are additional instructions. Streaming and tool calls pass through.
