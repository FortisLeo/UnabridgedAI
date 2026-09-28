import type { Settings } from "../types.ts";

export const settingsSaves = () => {
  const latest = new Map<keyof Settings, symbol>();
  return (patch: Partial<Settings>) => {
    const token = Symbol();
    const fields = Object.keys(patch) as Array<keyof Settings>;
    for (const field of fields) latest.set(field, token);
    return () => Object.fromEntries(fields.filter((field) => latest.get(field) === token).map((field) => [field, patch[field]])) as Partial<Settings>;
  };
};
