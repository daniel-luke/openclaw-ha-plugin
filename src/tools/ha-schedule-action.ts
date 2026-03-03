import type { DeviceRegistry } from '../device-registry.js'

export interface ScheduleActionConfig {
  reportingChannel?: string
}

export function makeScheduleActionTool(
  getRegistry: () => DeviceRegistry,
  getConfig: () => ScheduleActionConfig,
) {
  return {
    name: 'ha_schedule_action',
    description:
      'Prepare a Home Assistant action for scheduling. ' +
      'Returns the parameters you must pass to cron.add to schedule the action. ' +
      'Always follow this tool call immediately with a cron.add call using the returned parameters.',
    parameters: {
      type: 'object' as const,
      properties: {
        when: {
          type: 'string',
          description:
            'When to execute the action. Use ISO 8601 datetime (e.g. "2025-06-01T22:00:00") ' +
            'or a human duration from now (e.g. "in 30 minutes", "in 2 hours"). ' +
            'The value will be passed as-is to cron.add.',
        },
        domain: {
          type: 'string',
          description: 'The HA domain of the service, e.g. "light", "switch", "climate".',
        },
        service: {
          type: 'string',
          description: 'The service action, e.g. "turn_on", "turn_off", "set_temperature".',
        },
        entity_id: {
          type: 'string',
          description: 'The entity ID to target, e.g. "light.living_room_main".',
        },
        service_data: {
          type: 'object',
          description: 'Optional additional data for the service call.',
        },
        label: {
          type: 'string',
          description: 'Human-readable label for the scheduled job, e.g. "Turn off living room lights at night".',
        },
      },
      required: ['when', 'domain', 'service', 'entity_id'],
    },
    async execute({
      when,
      domain,
      service,
      entity_id,
      service_data,
      label,
    }: {
      when: string
      domain: string
      service: string
      entity_id: string
      service_data?: Record<string, unknown>
      label?: string
    }): Promise<unknown> {
      const registry = getRegistry()
      await registry.ensureLoaded()

      if (!registry.isEnabled(entity_id)) {
        return {
          error: `Device "${entity_id}" is disabled in the workspace ha/ configuration. Enable it or choose a different device.`,
        }
      }

      const config = getConfig()
      const deviceName = registry.getDevice(entity_id)?.name ?? entity_id
      const serviceDataStr = service_data ? `, service_data=${JSON.stringify(service_data)}` : ''
      const jobLabel = label ?? `${domain}.${service} on ${deviceName}`

      const agentPrompt =
        `Execute scheduled Home Assistant action: ` +
        `call ha_call_service with domain="${domain}", service="${service}", entity_id="${entity_id}"${serviceDataStr}. ` +
        `This is scheduled job "${jobLabel}". After executing, confirm success to the user.`

      return {
        message: `Action validated. Now call cron.add with the parameters below to schedule "${jobLabel}".`,
        cron_add_params: {
          prompt: agentPrompt,
          schedule: { kind: 'at', at: when },
          label: jobLabel,
          ...(config.reportingChannel ? { channel: config.reportingChannel } : {}),
        },
      }
    },
  }
}
