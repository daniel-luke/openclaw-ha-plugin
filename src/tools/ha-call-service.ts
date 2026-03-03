import type { HAClient } from '../ha-client.js'
import type { DeviceRegistry } from '../device-registry.js'

export interface CallServiceConfig {
  reportingChannel?: string
  reportingEnabled?: boolean
}

export type SendToChannel = (channelId: string, message: string) => Promise<void>

export function makeCallServiceTool(
  getClient: () => HAClient,
  getRegistry: () => DeviceRegistry,
  getConfig: () => CallServiceConfig,
  sendToChannel: SendToChannel,
) {
  return {
    name: 'ha_call_service',
    description:
      'Call a Home Assistant service to control a device. ' +
      'Common services: light.turn_on, light.turn_off, light.toggle, ' +
      'switch.turn_on, switch.turn_off, switch.toggle, ' +
      'climate.set_temperature, climate.set_hvac_mode, ' +
      'cover.open_cover, cover.close_cover, cover.stop_cover, ' +
      'lock.lock, lock.unlock, ' +
      'media_player.media_play, media_player.media_pause, media_player.volume_set.',
    parameters: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'The HA domain of the service, e.g. "light", "switch", "climate".',
        },
        service: {
          type: 'string',
          description: 'The service action to call, e.g. "turn_on", "turn_off", "toggle".',
        },
        entity_id: {
          type: 'string',
          description: 'The entity ID to target, e.g. "light.living_room_main".',
        },
        service_data: {
          type: 'object',
          description:
            'Optional additional data for the service call. Examples: ' +
            '{ "brightness_pct": 80 } for lights, ' +
            '{ "temperature": 21 } for climate, ' +
            '{ "volume_level": 0.5 } for media players.',
        },
      },
      required: ['domain', 'service', 'entity_id'],
    },
    async execute(
      _ctx: unknown,
      {
        domain,
        service,
        entity_id,
        service_data = {},
      }: {
        domain: string
        service: string
        entity_id: string
        service_data?: Record<string, unknown>
      },
    ): Promise<unknown> {
      const registry = getRegistry()
      await registry.ensureLoaded()

      if (!registry.isEnabled(entity_id)) {
        return {
          error: `Device "${entity_id}" is disabled in the workspace ha/ configuration. Enable it or choose a different device.`,
        }
      }

      const affectedStates = await getClient().callService(domain, service, {
        entity_id,
        ...service_data,
      })

      const config = getConfig()
      const deviceName = registry.getDevice(entity_id)?.name ?? entity_id
      const serviceLabel = `${domain}.${service}`
      const summary = `Called ${serviceLabel} on "${deviceName}".`

      if (config.reportingEnabled !== false && config.reportingChannel) {
        try {
          await sendToChannel(config.reportingChannel, `✅ ${summary}`)
        } catch (err) {
          console.warn('[ha-plugin] Failed to send channel notification:', err)
        }
      }

      return {
        success: true,
        summary,
        entity_id,
        service: serviceLabel,
        affected_states: affectedStates.length,
      }
    },
  }
}
