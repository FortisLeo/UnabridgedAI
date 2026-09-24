const leaked = /0-0\.pro|api\.0-0|ZERO_ZERO|x-api-key|sk-|Bearer\s+[A-Za-z0-9._-]+/gi;

export const publicError = (status: number, fallback = "UnabridgedAI is unavailable right now.") => {
  if (status === 401 || status === 403) return "This channel is not authorized.";
  if (status === 429) return "Too many requests. Try again in a moment.";
  if (status === 503) return "UnabridgedAI is not configured on this server.";
  return fallback;
};

export const scrub = (value: string) => value.replace(leaked, "[redacted]");

export const openaiError = (message: string, type = "invalid_request_error", code: string | null = null) => ({
  error: { message: scrub(message), type, param: null, code },
});
