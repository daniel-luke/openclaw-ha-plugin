import type { DeviceRegistry } from '../device-registry.js'
import { addCronJob } from '../cron-client.js'

export interface ScheduleActionConfig {
  reportingChannel?: string
  gatewayUrl?: string
  gatewayToken?: string
}

export function makeScheduleActionTool(
  getRegistry: () => DeviceRegistry,
  getConfig: () => ScheduleActionConfig,
) {
  return {
    name: 'ha_schedule_action',
    description:
      'Schedule a Home Assistant device action to run at a specific time in the future. ' +
      'The action is registered as a cron job directly — no follow-up action is needed from you. ' +
      'Always convert natural language times to ISO 8601 before calling this tool (e.g. "tonight at 11pm" → "2025-06-01T23:00:00").',
    parameters: {
      type: 'object' as const,
      properties: {
        when: {
          type: 'string',
          description:
            'ISO 8601 datetime for when to run the action, e.g. "2025-06-01T23:00:00". ' +
            'Convert natural language ("tonight at 11", "in 2 hours") to ISO 8601 before calling.',
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
          description: 'Human-readable label for the job, e.g. "Turn off garden lights at night".',
        },
      },
      required: ['when', 'domain', 'service', 'entity_id'],
    },
    async execute(
      _ctx: unknown,
      {
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
      },
    ): Promise<unknown> {
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
      const jobLabel = label ?? `${domain}.${service} on ${deviceName} at ${when}`

      // Resolve gateway credentials — prefer plugin config, fall back to env vars
      const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT ?? '18789'
      const gatewayToken =
        config.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? ''

      if (!gatewayToken) {
        return {
          error:
            'No gateway token available. Set OPENCLAW_GATEWAY_TOKEN in the environment ' +
            'or add gatewayToken to the plugin configuration.',
        }
      }

      const agentMessage =
        `Execute scheduled Home Assistant action: ` +
        `call ha_call_service with domain="${domain}", service="${service}", entity_id="${entity_id}"${serviceDataStr}.`

      const result = await addCronJob(gatewayPort, gatewayToken, {
        name: jobLabel,
        schedule: { kind: 'at', at: when },
        sessionTarget: 'isolated',
        payload: { kind: 'agentTurn', message: agentMessage },
        deleteAfterRun: true,
        ...(config.reportingChannel
          ? { delivery: { mode: 'announce', channel: config.reportingChannel } }
          : {}),
      })

      return {
        success: true,
        message: `Scheduled: "${jobLabel}" will run at ${when}.`,
        job_id: result.id,
      }
    },
  }
}
