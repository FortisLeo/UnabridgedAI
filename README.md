# UnabridgedAI

Single-host React UI and Express API backed by SQLite. The browser uses `/api` on the same origin. Development runs Vite as Express middleware; production serves `dist/`.

```text
web/        React UI, including features/admin/pages and components
src/        Express API, repositories, payment watchers, SQLite migrations
scripts/    Operator pricing, signing, and sweep utilities
prompts/    System prompt
```

Requires Node.js 20 or newer. Use the same Node version and database path for the application and operator commands.

## Fresh installation

```bash
npm ci
cp .env.example .env
```

Set `ZERO_ZERO_API_KEY` (or `ZERO_ZERO_API_KEYS`) in `.env`. Set payment and admin configuration below if those features are needed.

```bash
npm run dev
```

Open `http://localhost:3001`. For production:

```bash
npm run build
npm start
```

`npm start` sets `NODE_ENV=production`. `PORT` defaults to 3001. Binding HTTP to port 443 does not itself enable TLS; use the existing HTTPS proxy/termination arrangement.

## Upgrade a host installation from 632978b

These steps cover a server currently at `632978b43c4a956469af465fc5d9d646f619a8e9`, running directly on the host rather than Docker.

The admin/subscription/address-sweep changes were merged into `main` in [PR #11](https://github.com/FortisLeo/UnabridgedAI/pull/11), commit `52f01bfaea4bb8ccc45fba7e44c4e36bbdaad34b`. Pull `main` to install the new setup. Do not reset a server checkout with local changes.

### 1. Locate the production database and stop writers

```bash
cd ~/UnabridgedAI
git status --short
git rev-parse HEAD
node --version
```

Inspect `DB_PATH` in `.env` and any overrides set by your service manager. A relative `DB_PATH` resolves against the repository root; the default is `unabridged.db` there. Set an absolute path to keep operator commands and the service consistent:

```env
DB_PATH=/root/UnabridgedAI/unabridged.db
```

Use your actual deployment path. Stop the app, payment watcher, signer, and scheduled sweep jobs before migration. For a foreground `npm start`, press Ctrl+C. For a managed service, use its actual name, for example:

```bash
sudo systemctl stop unabridged
```

Or, if managed by PM2:

```bash
pm2 stop unabridged
```

Choose the command matching your process manager; do not run both blindly.

### 2. Back up SQLite, configuration, and the old revision

Run in Bash, replacing the database path with the path verified above. This uses SQLite's backup API so committed WAL data is included; copying only the `.db` file can omit WAL transactions.

```bash
umask 077
export DEPLOY_DB_PATH=/root/UnabridgedAI/unabridged.db
export DEPLOY_BACKUP_DIR="$HOME/unabridged-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEPLOY_BACKUP_DIR"
git rev-parse HEAD > "$DEPLOY_BACKUP_DIR/revision.txt"
cp .env "$DEPLOY_BACKUP_DIR/env"
node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
import { join } from 'node:path';
const db = new Database(process.env.DEPLOY_DB_PATH, { readonly: true, fileMustExist: true });
await db.backup(join(process.env.DEPLOY_BACKUP_DIR, 'unabridged.db'));
db.close();
console.log('SQLite backup complete');
NODE
```

Keep this backup outside the repository and copy it to your backup storage. Record the directory for rollback.

### 3. Fetch the intended release and install dependencies

Update to the merged release:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
npm ci
```

Preserve `.env`; do not overwrite an existing production configuration with `.env.example`. Install development dependencies too, since `npm run build` requires TypeScript and Vite.

### 4. Configure the admin console

Normal customer accounts are separate from admin authentication. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`. Generate the hash with a hidden prompt so the password is not stored as a literal shell-history command:

```bash
read -r -s -p 'New admin password: ' DEPLOY_ADMIN_PASSWORD
printf '\n'
export DEPLOY_ADMIN_PASSWORD
npx tsx -e 'import { passwordHash } from "./src/lib/crypto.ts"; console.log(passwordHash(process.env.DEPLOY_ADMIN_PASSWORD!))'
unset DEPLOY_ADMIN_PASSWORD
```

Paste the generated `salt:hash` into `.env`:

```env
ADMIN_USERNAME=operator
ADMIN_PASSWORD_HASH=PASTE_THE_GENERATED_HASH
```

Use a long, unique password. No admin database insert is needed. Admin sessions are stored in SQLite and expire after eight hours. Restart the application after changing admin credentials. `ADMIN_TOKEN` is optional static-cookie access; leave it unset for ordinary password login.

Keep existing provider credentials and xpub. For stablecoin payments, configure only the networks you intend to accept:

```env
EVM_ACCOUNT_XPUB=your_existing_account_xpub
POLYGON_RPC_URLS=https://your-polygon-primary,https://your-polygon-backup
ETHEREUM_RPC_URLS=https://your-ethereum-primary,https://your-ethereum-backup
PAYMENT_WATCH_MS=15000
```

The account xpub is at `m/44'/60'/0'`; derived addresses use `/0/i`. Do not change it during this upgrade or reset address counters: the existing deposit addresses and signer must retain the same derivation mapping. Never put an xprv or seed in the web app environment.

If there is one trusted reverse proxy, configure `TRUST_PROXY=1` only when it matches the actual proxy topology. Preserve working cookie/TLS configuration. `.env` loads automatically, but explicit process-manager environment variables take precedence.

### 5. Run SQLite migrations explicitly

There is no separate migration CLI or Supabase step. Importing `src/db/client.ts` applies the schema and startup migrations. Run this once while the app is stopped, against the exact production database:

```bash
DB_PATH="$DEPLOY_DB_PATH" npx tsx -e '
import { db, closeDb } from "./src/db/client.ts";
console.log("integrity:", db.pragma("integrity_check"));
console.log("foreign keys:", db.pragma("foreign_key_check"));
console.log("prices:", db.prepare("SELECT key, value FROM payment_settings ORDER BY key").all());
console.log("Pro accounts:", db.prepare("SELECT username, pro_expires_at FROM users WHERE plan = ?").all("pro"));
closeDb();
'
```

Expect integrity `ok` and an empty foreign-key-check result. Startup also applies migrations on subsequent runs. Changes include:

- `users.pro_expires_at` for 28-day Pro entitlements.
- Admin sessions, audit events, withdrawal request records, chain health, and unmatched transfers.
- Address lease metadata and `payment_address_leases`.
- Removal of invoice-address uniqueness while retaining invoice history.
- Legacy EVM lease backfill and release of successful leases under the event-attribution policy.

Address-sweep storage is initialized by the sweep/report feature when accessed. Historical invoice sweep data remains for reference.

**Legacy Pro access changes:** expiry is calculated from the latest successful invoice's settlement plus 28 days. An older purchase may already be expired. A Pro account with no successful settlement timestamp remains without an expiry and is not treated as active Pro. Inspect these accounts before reopening the service; renewal grants a new 28-day period. Do not promise existing lifetime access survives unchanged.

### 6. Check or initialize payment pricing

`pro_price_cents` is stored in SQLite; setting `PRO_PRICE_CENTS` in `.env` does not initialize it. Existing configured prices survive the upgrade. If missing, set the intended price, for example $15.00:

```bash
DB_PATH="$DEPLOY_DB_PATH" npx tsx scripts/payment-price.ts pro_price_cents 1500
```

Once the app runs, Admin → Settings can update the Pro price in USD. Changes affect new invoices; existing invoice amounts stay fixed. Monero pricing is independent, using `xmr_atomic_units` in the same table:

```bash
DB_PATH="$DEPLOY_DB_PATH" npx tsx scripts/payment-price.ts xmr_atomic_units 100000000000
```

That example is 0.1 XMR; choose your intended amount. Set it only if Monero payments are enabled.

### 7. Build, restart, and verify

```bash
npm run build
npm start
```

For a service manager, start the existing service instead of launching a second server. PM2 requires `--update-env` when changing its inherited environment:

```bash
pm2 restart unabridged --update-env
```

Or:

```bash
sudo systemctl start unabridged
sudo journalctl -u unabridged -n 100 --no-pager
```

Verify at the configured local port and through the public origin:

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://unabridgedai.xyz/api/health
```

Adjust the local port if your service uses another value. Health should return `{"ok":true,"db":true}`. Check `/admin`, sign in, verify Settings pricing and Balances, navigate back to Overview, and check the customer Billing page's validity date. Watch logs for RPC failures such as `RPC 500` or `RPC 529`; a healthy database endpoint does not prove the blockchain watcher is healthy.

### Rollback

Stop the app and all payment writers first. Restore both the prior revision and its matching database backup; rolling back code alone does not reverse schema or entitlement changes. Preserve the current database separately before restoring. Restore the saved `.env`, install dependencies for the old revision, build, and restart. Do not restore an old payment backup after accepting new payments without reconciling the intervening transfers and entitlements.

## Payment behavior and batch sweeps

The merged implementation uses finalized transfer events (chain, transaction hash, log index) for EVM invoice settlement. Existing wallet balances do not count toward a new invoice. Ethereum and Polygon share derived addresses but have separate chain leases. Successful settlement makes the address reusable immediately; unpaid/partial invoices wait until their payment deadline plus 20 minutes. **The current configured invoice deadline is 60 minutes**, not 30 minutes. Solana and Monero keep their separate address allocation mechanisms.

A reused address cannot reveal which invoice a sender intended. New EVM events are assigned by block-time windows; known events retain their existing owner, and transfers outside invoice windows remain unmatched for reconciliation. A late transfer included during a newer invoice's window is inherently ambiguous without a sender/amount/invoice identifier.

Sweeps consolidate an address's token balance independently of invoices and do not determine Pro access. The web process never holds the spend key. Optional EVM sweep configuration:

```env
POLYGON_COLD_ADDRESS=0xYourPolygonDestination
ETHEREUM_COLD_ADDRESS=0xYourEthereumDestination
SWEEP_SIGNER_URL=http://127.0.0.1:8787
```

The signer is a separate localhost process with its own protected `EVM_ACCOUNT_XPRV` environment and matching destination whitelist. Keep it bound to localhost; do not add that key to the web service's `.env`. Deposit addresses need POL or ETH gas before ERC-20 consolidation. There is no automatic native-gas funding or periodic sweep schedule.

An operator can call the batch service directly (it returns address-sweep IDs):

```bash
npx tsx -e 'import { runSweep } from "./src/payments/evm-sweep.ts"; import { closeDb } from "./src/db/client.ts"; try { console.log(await runSweep("polygon")); } finally { closeDb(); }'
```

Replace `polygon` with `ethereum` for that network. Run only with the signer, RPC, destination, and gas configured. Subsequent runs reconcile broadcasts after finalized receipts before planning more sweeps. For confirmation only, without creating new transfers:

```bash
npx tsx -e 'import { confirmBroadcastSweeps } from "./src/payments/evm-sweep.ts"; import { closeDb } from "./src/db/client.ts"; try { console.log(await confirmBroadcastSweeps("polygon")); } finally { closeDb(); }'
```

These address-level service calls require the merged release; they are not present at `632978b`. Admin withdrawal requests/approvals are recorded, but do not automatically broadcast through the signer.

## Docker

For a fresh Docker deployment:

```bash
cp .env.example .env
# Configure keys, admin credentials, and supported payment networks.
docker compose up --build
```

Data lives in the `unabridged-data` volume at `/data/unabridged.db`. Run database operator commands inside the container so they use this database. Recreate the container after `.env` changes. The host upgrade instructions above do not apply to the Docker database path.

EVM payment attribution uses individual finalized transfer events, keyed by chain, transaction hash, and log index. Successful settlement releases the address lease immediately, even while funds accumulate. Unpaid and partial invoices become reusable after their payment deadline plus a 20-minute quarantine. Transfers outside an invoice's block-time window are retained for reconciliation; the sender's intended invoice cannot be inferred from a reused address alone.

EVM sweeps consolidate each address/token balance independently of invoices. Run the operator sweep CLI periodically; broadcasts remain pending until a later reconciliation observes a finalized receipt. Confirming a sweep never modifies a newer invoice lease. Historical invoice-owned sweep records remain in SQLite for reference; new sweep jobs use `payment_address_sweeps`.

## OpenAI-compatible API

Create named keys under **Get API**, then configure an OpenAI-compatible client:

```text
base URL: http://localhost:3001/v1
API key:  uai_...
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3001/v1", api_key="uai_...")
print(client.chat.completions.create(
    model="unabridged",
    messages=[{"role": "user", "content": "Hello."}],
).choices[0].message.content)
```

The UnabridgedAI system prompt is prepended. API keys authorize `/v1`; browser account/admin flows use their respective session cookies. Free accounts receive three requests. Each settled Pro payment grants 28 days; an early renewal extends from the current expiry, and an expired renewal starts from settlement time.
