import { db, closeDb } from "../src/db/client.ts";

const [key, value] = process.argv.slice(2);
if ((key !== "pro_price_cents" && key !== "xmr_atomic_units") || !/^[0-9]+$/.test(value ?? "") || BigInt(value) <= 0n) {
  console.error("usage: tsx scripts/payment-price.ts <pro_price_cents|xmr_atomic_units> <positive-integer>");
  process.exit(1);
}
db.prepare("INSERT INTO payment_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value.replace(/^0+(?=\d)/, ""));
closeDb();
console.log(`set ${key}`);
