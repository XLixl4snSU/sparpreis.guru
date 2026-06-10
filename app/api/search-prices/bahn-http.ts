import { Agent, type Dispatcher } from "undici"

interface BahnHttpOptions {
  method?: "GET" | "POST"
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

interface BahnHttpResponse {
  status: number
  ok: boolean
  text: () => Promise<string>
  json: <T = unknown>() => Promise<T>
}

const bahnAgent = new Agent({
  connect: {
    maxVersion: "TLSv1.2",
  },
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
})

export async function fetchBahn(url: string, options: BahnHttpOptions = {}): Promise<BahnHttpResponse> {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "www.bahn.de") {
    throw new Error("fetchBahn only supports https://www.bahn.de URLs")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45_000)

  try {
    const response = await fetch(parsedUrl, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      // bahn.de currently blocks Node 24/OpenSSL 3.5's TLS 1.3 ClientHello with
      // OPS_BLOCKED, while the same request succeeds with TLS 1.2. Keep this
      // scoped to bahn.de instead of lowering TLS globally for the process.
      dispatcher: bahnAgent,
    } as RequestInit & { dispatcher: Dispatcher })

    return {
      status: response.status,
      ok: response.ok,
      text: () => response.text(),
      json: <T = unknown>() => response.json() as Promise<T>,
    }
  } finally {
    clearTimeout(timeout)
  }
}
