// Groq endpoints. The free route's proxy URL joins this file with the Worker
// (spec §1); until then only the direct (own key) route exists.

export const GROQ_API_BASE = "https://api.groq.com/openai/v1";
export const GROQ_CHAT_COMPLETIONS_URL = `${GROQ_API_BASE}/chat/completions`;
/** Key validation: lists models, uses no tokens (spec §6). */
export const GROQ_MODELS_URL = `${GROQ_API_BASE}/models`;
/** Longest key accepted before a network check (spec §6 shape check). */
export const GROQ_API_KEY_MAX_CHARS = 512;
