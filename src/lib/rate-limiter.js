export function createRateLimiter(intervalMs = 3000) {
  let lastCall = 0;

  return async function wait() {
    const now = Date.now();
    const elapsed = now - lastCall;
    if (elapsed < intervalMs) {
      await new Promise((r) => setTimeout(r, intervalMs - elapsed));
    }
    lastCall = Date.now();
  };
}
