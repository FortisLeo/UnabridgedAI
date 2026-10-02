import { getEncoding } from "js-tiktoken";

// The upstream model's tokenizer is not exposed by the provider. o200k_base is
// the closest public modern OpenAI tokenizer and gives a deterministic,
// conservative-enough estimate for the free-tier input guard.
const encoding = getEncoding("o200k_base");

export const inputTokenCount = (text: string) => encoding.encode(text).length;
