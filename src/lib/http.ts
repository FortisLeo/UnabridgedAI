export const paramId = (value: string | string[]) => (Array.isArray(value) ? value[0] : value);

export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 48) || "Untitled session";
