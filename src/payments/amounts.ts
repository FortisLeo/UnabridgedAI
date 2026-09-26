const DIGITS = /^[0-9]+$/;

export class AmountError extends Error {}

export const parseBaseUnits = (value: string): bigint => {
  const trimmed = value.trim();
  if (!DIGITS.test(trimmed) || trimmed.length > 40) throw new AmountError("Amount is not a canonical integer");
  const normalized = trimmed.replace(/^0+(?=\d)/, "");
  return BigInt(normalized);
};

export const formatBaseUnits = (value: bigint): string => {
  if (value < 0n) throw new AmountError("Amount cannot be negative");
  return value.toString();
};

export const displayAmount = (baseUnits: bigint, decimals: number): string => {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const text = abs.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
};

export const stablecoinQuote = (priceCents: bigint): bigint => {
  if (priceCents <= 0n) throw new AmountError("Price must be positive");
  return priceCents * 10_000n;
};

export const moneroQuote = (atomicUnits: bigint): bigint => {
  if (atomicUnits <= 0n) throw new AmountError("Price must be positive");
  return atomicUnits;
};

export const addBaseUnits = (left: string, right: string) => formatBaseUnits(parseBaseUnits(left) + parseBaseUnits(right));

export const compareBaseUnits = (left: string, right: string) => {
  const a = parseBaseUnits(left);
  const b = parseBaseUnits(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};
