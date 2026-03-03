import type { HAClient } from '../ha-client.js'
import type { DeviceRegistry } from '../device-registry.js'

export function makeGetStatesTool(
  getClient: () => HAClient,
  getRegistry: () => DeviceRegistry,
) {
  return {
    name: 'ha_get_states',
    description:
      'Get the current state of one or more Home Assistant entities. ' +
      'Use this to check if a device is on or off, its current value, or any attributes like brightness or temperature.',
    parameters: {
      type: 'object' as const,
      properties: {
        entity_id: {
          type: 'string',
          description:
            'The exact entity ID to query (e.g. light.living_room_main). ' +
            'Omit to get the state of all entities in the workspace registry.',
        },
      },
      required: [],
    },
    async execute(_ctx: unknown, { entity_id }: { entity_id?: string }): Promise<unknown> {
      const registry = getRegistry()
      await registry.ensureLoaded()

      const states = await getClient().getStates(entity_id)

      return states.map((s) => {
        const registered = registry.getDevice(s.entity_id)
        return {
          entity_id: s.entity_id,
          name: registered?.name ?? s.attributes.friendly_name ?? s.entity_id,
          room: registered?.room ?? null,
          state: s.state,
          attributes: s.attributes,
          last_changed: s.last_changed,
        }
      })
    },
  }
}