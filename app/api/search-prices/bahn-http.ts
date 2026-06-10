import { request as httpsRequest } from "node:https"
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib"

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

function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer {
  const encoding = contentEncoding?.toLowerCase()
  if (encoding === "gzip") return gunzipSync(body)
  if (encoding === "br") return brotliDecompressSync(body)
  if (encoding === "deflate") return inflateSync(body)
  return body
}

export function fetchBahn(url: string, options: BahnHttpOptions = {}): Promise<BahnHttpResponse> {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "www.bahn.de") {
    throw new Error("fetchBahn only supports https://www.bahn.de URLs")
  }

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      parsedUrl,
      {
        method: options.method || "GET",
        headers: options.headers,
        // bahn.de currently blocks Node 24/OpenSSL 3.5's TLS 1.3 ClientHello with
        // OPS_BLOCKED, while the same request succeeds with TLS 1.2. Keep this
        // scoped to bahn.de instead of lowering TLS globally for the process.
        maxVersion: "TLSv1.2",
      },
      response => {
        const chunks: Buffer[] = []

        response.on("data", chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        response.on("end", () => {
          try {
            const rawBody = Buffer.concat(chunks)
            const decodedBody = decodeBody(rawBody, response.headers["content-encoding"] as string | undefined)
            const bodyText = decodedBody.toString("utf-8")

            resolve({
              status: response.statusCode || 0,
              ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
              text: async () => bodyText,
              json: async <T>() => JSON.parse(bodyText) as T,
            })
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    request.setTimeout(options.timeoutMs || 45_000, () => {
      request.destroy(new Error("Bahn request timed out"))
    })
    request.on("error", reject)

    if (options.body) {
      request.write(options.body)
    }

    request.end()
  })
}
