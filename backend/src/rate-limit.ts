type RateLimitState = {
  count: number
  windowStart: number
}

export type RateLimiter = {
  check: (key: string) => boolean
}

export function createRateLimiter(windowMs: number, maxRequests: number): RateLimiter {
  const buckets = new Map<string, RateLimitState>()

  function pruneStaleBuckets(now: number) {
    if (buckets.size < 1000) {
      return
    }

    for (const [key, state] of buckets.entries()) {
      if (now - state.windowStart >= windowMs) {
        buckets.delete(key)
      }
    }
  }

  return {
    check(key: string) {
      const now = Date.now()
      pruneStaleBuckets(now)

      const current = buckets.get(key)

      if (!current || now - current.windowStart >= windowMs) {
        buckets.set(key, { count: 1, windowStart: now })
        return true
      }

      if (current.count >= maxRequests) {
        return false
      }

      current.count += 1
      return true
    },
  }
}
