/** Whether a crew server is configured. Without one the app runs solo and the crew features stay hidden. */
export const CONVEX_URL: string | undefined = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() || undefined;
export const NET_ENABLED = CONVEX_URL !== undefined;
