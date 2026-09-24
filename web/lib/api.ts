export class ApiError extends Error {
  status: number;
  code?: string;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = typeof payload.code === "string" ? payload.code : undefined;
    this.payload = payload;
  }
}

export const api = async <T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      ...options,
    });
  } catch {
    throw new ApiError("Backend is not running. Start it with npm run dev.", 0);
  }
  const raw = await response.text();
  let data: T & { error?: string; code?: string } = {} as T & { error?: string; code?: string };
  if (raw) {
    try {
      data = JSON.parse(raw) as T & { error?: string; code?: string };
    } catch {
      if (!response.ok) throw new ApiError("The channel dropped before a reply came back.", response.status);
    }
  }
  if (!response.ok) throw new ApiError(data.error ?? "Something went wrong", response.status, data as Record<string, unknown>);
  return data;
};
