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

## Admin console

The read-only operations console is available at `/admin`. Configure separate admin credentials in `.env` before using it:

```bash
ADMIN_USERNAME=operator
ADMIN_PASSWORD_HASH=$(npx tsx -e 'import { passwordHash } from "./src/lib/crypto.ts"; console.log(passwordHash(process.env.ADMIN_PASSWORD ?? "change-this"))' )
```

Set the hash from a secure shell environment, restart the service, and open `https://your-host/admin`. The console shows SQLite-backed users, invoices, credits, address states, payment settings, recent payment events, and RPC configuration. It does not expose private keys or fund-moving controls.

## Crypto invoices

Pro can be bought with USDT or USDC on Ethereum, Polygon, and Solana, or with Monero. Ethereum and Polygon share one account xpub (`EVM_ACCOUNT_XPUB`, path `m/44'/60'/0'/0/i`). Solana uses an indexed list of pre-derived owner public keys (`SOLANA_OWNER_PUBKEYS`) because its derivation path is hardened. Monero uses one view-only `monero-wallet-rpc` on localhost. The web process never holds a spend key.

Each invoice gets a fresh address. The browser polls `GET /api/billing/invoices/:id`. There is no payment webhook. Pro is set once settled eligible funds reach or exceed the expected base-unit amount: the chain `finalized` tag for stablecoins, and 10 confirmations with no future unlock time for Monero. Set the operator price with `tsx scripts/payment-price.ts pro_price_cents 1500`. Leave the price unset and invoice creation returns 503.


EVM payment attribution uses individual finalized transfer events, keyed by chain, transaction hash, and log index. Successful settlement releases the address lease immediately, even while funds accumulate. Unpaid and partial invoices become reusable after their payment deadline plus a 20-minute quarantine. Transfers outside an invoice's block-time window are retained for reconciliation; the sender's intended invoice cannot be inferred from a reused address alone.

EVM sweeps consolidate each address/token balance independently of invoices. Run the operator sweep CLI periodically; broadcasts remain pending until a later reconciliation observes a finalized receipt. Confirming a sweep never modifies a newer invoice lease. Historical invoice-owned sweep records remain in SQLite for reference; new sweep jobs use `payment_address_sweeps`.

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

The UnabridgedAI system prompt is always prepended. Extra `system` messages from the client are additional instructions. Streaming and tool calls pass through. API keys authorize `/v1` only; the web app uses the session cookie.
