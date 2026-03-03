import * as path from 'path'
import { HAClient } from './ha-client.js'
import { DeviceRegistry } from './device-registry.js'
import { runSetup } from './setup.js'
import { makeGetStatesTool } from './tools/ha-get-states.js'
import { makeListEntitiesTool } from './tools/ha-list-entities.js'
import { makeCallServiceTool } from './tools/ha-call-service.js'
import { makeScheduleActionTool } from './tools/ha-schedule-action.js'

interface PluginConfig {
  haUrl: string
  haToken: string
  reportingChannel?: string
  reportingEnabled?: boolean
  workspaceHaDir?: string
}

// OpenClaw plugin API — types are inferred from usage since the SDK types
// may not be installed. Adjust if openclaw exports a typed package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function register(api: any): void {
  const config = api.config as PluginConfig

  const haClient = new HAClient(config.haUrl, config.haToken)

  // Resolve workspace ha/ directory
  const haDir = path.resolve(
    api.workspace?.path?.(config.workspaceHaDir ?? 'ha') ??
      path.join(process.env.HOME ?? '~', '.openclaw', 'workspace', config.workspaceHaDir ?? 'ha'),
  )

  const registry = new DeviceRegistry(haDir)

  // Load device registry on startup
  api.registerService?.({
    id: 'ha-device-registry',
    async start() {
      await registry.load()

      // Auto-generate workspace files if the ha/ directory doesn't exist yet
      const fs = await import('fs')
      if (!fs.existsSync(haDir)) {
        api.logger?.info('[ha-plugin] ha/ workspace folder not found — running initial setup...')
        try {
          await runSetup(haClient, haDir)
          await registry.reload()
        } catch (err) {
          api.logger?.warn('[ha-plugin] Auto-setup failed:', err)
          api.logger?.warn('[ha-plugin] Run "openclaw ha init" manually after configuring the plugin.')
        }
      }
    },
  })

  // Inject device context into every agent turn so the LLM can resolve
  // natural language device references (e.g. "donut lamp" → entity_id)
  api.registerHook?.(
    'command:new',
    async () => {
      await registry.ensureLoaded()
      const block = registry.buildContextBlock()
      if (!block) return undefined
      return { systemContext: block }
    },
    { description: 'Inject HA device list for natural language device resolution' },
  )

  // Channel reporting helper — attempts to use the OpenClaw channels API
  const sendToChannel = async (channelId: string, message: string): Promise<void> => {
    try {
      await api.runtime?.channels?.send?.(channelId, message)
    } catch {
      // Graceful fallback — log so the user can see the notification
      api.logger?.info(`[ha-plugin] Channel notification (${channelId}): ${message}`)
    }
  }

  // Register tools
  api.registerTool?.(makeGetStatesTool(haClient, registry))
  api.registerTool?.(makeListEntitiesTool(haClient, registry))
  api.registerTool?.(
    makeCallServiceTool(haClient, registry, config, sendToChannel),
  )
  api.registerTool?.(makeScheduleActionTool(registry, config))

  // Register CLI: `openclaw ha init` and `openclaw ha reload`
  api.registerCli?.({
    name: 'ha',
    description: 'Home Assistant plugin commands',
    subcommands: [
      {
        name: 'init',
        description: 'Generate ha/ workspace YAML files by fetching entities from Home Assistant',
        async handler() {
          await runSetup(haClient, haDir)
          await registry.reload()
        },
      },
      {
        name: 'reload',
        description: 'Reload the ha/ workspace YAML files without restarting OpenClaw',
        async handler() {
          await registry.reload()
          const count = registry.getEnabledDevices().length
          console.log(`Reloaded — ${count} enabled device(s) in registry.`)
        },
      },
    ],
  })
}
