// Fast UI estimate. The server performs the authoritative count with the same
// o200k_base tokenizer before accepting a free-tier request.
export const inputTokenCount = (text: string) => Math.ceil([...text].length / 4);
