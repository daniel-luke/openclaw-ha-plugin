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

export interface HAArea {
  area_id: string
  name: string
}

export interface HAEntityRegistryEntry {
  entity_id: string
  area_id: string | null
  name: string | null          // user-defined override name
  original_name: string | null // name from the integration
}

export class HAClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

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

  async getAreas(): Promise<HAArea[]> {
    const res = await fetch(`${this.baseUrl}/api/config/area_registry/list`, {
      headers: this.headers(),
    })
    if (!res.ok) return []
    return res.json() as Promise<HAArea[]>
  }

  async getEntityRegistry(): Promise<HAEntityRegistryEntry[]> {
    const res = await fetch(`${this.baseUrl}/api/config/entity_registry/list`, {
      headers: this.headers(),
    })
    if (!res.ok) return []
    return res.json() as Promise<HAEntityRegistryEntry[]>
  }

  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
  ): Promise<HAState[]> {
    const url = `${this.baseUrl}/api/services/${domain}/${service}`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(serviceData),
    })
    if (!res.ok) {
      throw new Error(`HA API error ${res.status}: ${await res.text()}`)
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
