export const FREE_REQUEST_LIMIT = 10;
export const SIGNUPS_PER_IP_WEEK = 4;
export const WEEK_MS = 1000 * 60 * 60 * 24 * 7;
export const SIGNUP_RATE = { windowMs: 60 * 60 * 1000, max: 3 };
export const SIGNIN_RATE = { windowMs: 15 * 60 * 1000, max: 10 };
export const CHAT_RATE = { windowMs: 60 * 1000, max: 20 };
export const AUTO_BLACKLIST_SIGNUPS = 5;
