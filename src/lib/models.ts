export const PUBLIC_MODEL = "unabridged";
export const UPSTREAM_MODEL = "grok-4.5";

const aliases = new Set(["unabridged", "unabridged-ai", "unabridgedai", PUBLIC_MODEL]);

export const listPublicModels = () => [
  {
    id: PUBLIC_MODEL,
    object: "model" as const,
    created: 1710000000,
    owned_by: "unabridged",
  },
];

export const isPublicModel = (id?: string) => !id || aliases.has(id.trim().toLowerCase());

export const toUpstreamModel = () => UPSTREAM_MODEL;

const leakedModel = /grok[\w.-]*|gpt-[\w.-]*|claude[\w.-]*|gemini[\w.-]*|o1[\w.-]*|o3[\w.-]*|0-0\.pro/gi;

export const scrubModelNames = (value: string) => value.replace(leakedModel, PUBLIC_MODEL);

export const maskModelField = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(maskModelField);
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    next[key] = key === "model" && typeof item === "string" ? PUBLIC_MODEL : maskModelField(item);
  }
  return next;
};

export const rewriteSse = (chunk: string) =>
  chunk
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return line;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return line;
      try {
        return `data: ${JSON.stringify(maskModelField(JSON.parse(data)))}`;
      } catch {
        return scrubModelNames(line);
      }
    })
    .join("\n");
