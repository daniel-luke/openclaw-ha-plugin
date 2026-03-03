import * as http from 'node:http'
import * as https from 'node:https'

export interface HAState {
  entity_id: string
  state: string
  attributes: {
    friendly_name?: string
    [key: string]: unknown
  }
  last_changed: string
  last_updated: string
}

export class HAClient {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    // Strip trailing slashes to prevent double-slash URLs
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
  }

  async getStates(entityId?: string): Promise<HAState[]> {
    const url = entityId
      ? `${this.baseUrl}/api/states/${entityId}`
      : `${this.baseUrl}/api/states`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`HA API error ${res.status}: ${await res.text()}`)
    }
    const data = (await res.json()) as HAState | HAState[]
    return entityId ? [data as HAState] : (data as HAState[])
  }

  /**
   * Returns a map of entity_id → area name using HA's template engine.
   * The area/entity registry is only available via WebSocket, but templates
   * expose the same data through areas(), area_entities(), and area_name().
   */
  async getEntityAreaMap(): Promise<Map<string, string>> {
    const template = `
{%- set pairs = namespace(items=[]) -%}
{%- for area_id in areas() -%}
  {%- for entity_id in area_entities(area_id) -%}
    {%- set pairs.items = pairs.items + [{"e": entity_id, "a": area_name(area_id)}] -%}
  {%- endfor -%}
{%- endfor -%}
{{ pairs.items | tojson }}`

    const result = await this.renderTemplate(template.trim())
    if (!result) return new Map()

    try {
      const pairs = JSON.parse(result) as Array<{ e: string; a: string }>
      return new Map(pairs.map(({ e, a }) => [e, a]))
    } catch {
      return new Map()
    }
  }

  /**
   * POST using Node.js http/https module (HTTP/1.1) instead of fetch.
   * Node.js native fetch uses HTTP/2 when the server supports it, but some
   * HA reverse proxies reject HTTP/2 POST requests while accepting GET fine.
   */
  private postHttp1(path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl)
      const isHttps = url.protocol === 'https:'
      const bodyBuffer = Buffer.from(body, 'utf-8')

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Length': bodyBuffer.byteLength,
        },
      }

      const req = (isHttps ? https : http).request(options, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `HA API error ${res.statusCode} at ${path}: ${text}\n` +
                `Request URL: ${url.href}\n` +
                `Request body: ${body}`,
              ),
            )
          } else {
            resolve(text)
          }
        })
      })

      req.on('error', reject)
      req.write(bodyBuffer)
      req.end()
    })
  }

  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
  ): Promise<HAState[]> {
    const body = JSON.stringify(serviceData)
    const text = await this.postHttp1(`/api/services/${domain}/${service}`, body)
    return JSON.parse(text) as HAState[]
  }

  async renderTemplate(template: string): Promise<string> {
    try {
      return await this.postHttp1('/api/template', JSON.stringify({ template }))
    } catch {
      return ''
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/`, { headers: this.headers() })
      return res.ok
    } catch {
      return false
    }
  }
}
