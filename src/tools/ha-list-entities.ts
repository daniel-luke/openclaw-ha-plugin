import type { HAClient } from '../ha-client.js'
import type { DeviceRegistry } from '../device-registry.js'

export function makeListEntitiesTool(haClient: HAClient, registry: DeviceRegistry) {
  return {
    name: 'ha_list_entities',
    description:
      'List all known Home Assistant devices from the workspace registry, enriched with their current state. ' +
      'Only returns devices that are enabled. Use a domain filter to narrow results.',
    parameters: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description:
            'Filter by HA domain, e.g. "light", "switch", "climate", "cover", "media_player". ' +
            'Omit to list devices across all domains.',
        },
      },
      required: [],
    },
    async handler({ domain }: { domain?: string }): Promise<unknown> {
      await registry.ensureLoaded()

      const devices = registry.getEnabledDevices()
      const filtered = domain
        ? devices.filter((d) => d.entity_id.startsWith(`${domain}.`))
        : devices

      const results = []
      for (const device of filtered) {
        try {
          const [state] = await haClient.getStates(device.entity_id)
          results.push({
            entity_id: device.entity_id,
            name: device.name,
            room: device.room,
            state: state?.state ?? 'unknown',
          })
        } catch {
          results.push({
            entity_id: device.entity_id,
            name: device.name,
            room: device.room,
            state: 'unavailable',
          })
        }
      }

      return results
    },
  }
}
