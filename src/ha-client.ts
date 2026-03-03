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
    // Strip trailing slashes — a double-slash URL (e.g. https://host//api/...)
    // is silently redirected on GET but often rejected with 400 on POST by proxies.
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private headers(): HeadersInit {
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

  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
  ): Promise<HAState[]> {
    const body = JSON.stringify(serviceData)

    const url = `${this.baseUrl}/api/services/${domain}/${service}`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        `HA API error ${res.status} calling ${domain}.${service}: ${text}\n` +
        `Request URL: ${url}\n` +
        `Request body: ${body}`,
      )
    }

    return res.json() as Promise<HAState[]>
  }

  async renderTemplate(template: string): Promise<string> {
    const url = `${this.baseUrl}/api/template`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ template }),
    })
    if (!res.ok) return ''
    return res.text()
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
