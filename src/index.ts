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
  gatewayToken?: string
}

// Shared state populated during service start, after api.config is available.
interface PluginState {
  haClient?: HAClient
  registry?: DeviceRegistry
  config?: PluginConfig
  haDir?: string
}

// OpenClaw plugin API — types are inferred from usage since the SDK types
// may not be installed. Adjust if openclaw exports a typed package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function register(api: any): void {
  const state: PluginState = {}

  function resolveHaDir(config: PluginConfig): string {
    return path.resolve(
      api.workspace?.path?.(config.workspaceHaDir ?? 'ha') ??
        path.join(process.env.HOME ?? '~', '.openclaw', 'workspace', config.workspaceHaDir ?? 'ha'),
    )
  }

  // Channel reporting helper
  const sendToChannel = async (channelId: string, message: string): Promise<void> => {
    try {
      await api.runtime?.channels?.send?.(channelId, message)
    } catch {
      api.logger?.info(`[ha-plugin] Channel notification (${channelId}): ${message}`)
    }
  }

  // Load device registry on startup — api.config is reliably available here
  api.registerService?.({
    id: 'ha-device-registry',
    async start() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = api.config as any

      // Try known locations for the plugin config
      const config: PluginConfig =
        raw?.haUrl ? raw :
        raw?.config?.haUrl ? raw.config :
        raw?.plugins?.entries?.['openclaw-ha-plugin']?.config ?? {}
      state.config = config
      state.haDir = resolveHaDir(config)
      state.haClient = new HAClient(config.haUrl, config.haToken)
      state.registry = new DeviceRegistry(state.haDir)

      await state.registry.load()

      // Auto-generate workspace files if the ha/ directory doesn't exist yet
      const fs = await import('fs')
      if (!fs.existsSync(state.haDir)) {
        api.logger?.info('[ha-plugin] ha/ workspace folder not found — running initial setup...')
        try {
          await runSetup(state.haClient, state.haDir)
          await state.registry.reload()
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
      if (!state.registry) return undefined
      await state.registry.ensureLoaded()
      const block = state.registry.buildContextBlock()
      if (!block) return undefined
      return { systemContext: block }
    },
    { description: 'Inject HA device list for natural language device resolution' },
  )

  // Register tools — closures read from state, which is populated by start()
  api.registerTool?.(
    makeGetStatesTool(
      () => state.haClient!,
      () => state.registry!,
    ),
  )
  api.registerTool?.(
    makeListEntitiesTool(
      () => state.haClient!,
      () => state.registry!,
    ),
  )
  api.registerTool?.(
    makeCallServiceTool(
      () => state.haClient!,
      () => state.registry!,
      () => state.config!,
      sendToChannel,
    ),
  )
  api.registerTool?.(
    makeScheduleActionTool(
      () => state.registry!,
      () => state.config!,
    ),
  )

  // Register CLI: `openclaw ha init` and `openclaw ha reload`
  api.registerCli?.({
    name: 'ha',
    description: 'Home Assistant plugin commands',
    subcommands: [
      {
        name: 'init',
        description: 'Generate ha/ workspace YAML files by fetching entities from Home Assistant',
        async handler() {
          if (!state.haClient || !state.haDir) {
            console.error('Plugin not yet started. Try again in a moment.')
            return
          }
          await runSetup(state.haClient, state.haDir)
          await state.registry?.reload()
        },
      },
      {
        name: 'reload',
        description: 'Reload the ha/ workspace YAML files without restarting OpenClaw',
        async handler() {
          await state.registry?.reload()
          const count = state.registry?.getEnabledDevices().length ?? 0
          console.log(`Reloaded — ${count} enabled device(s) in registry.`)
        },
      },
    ],
  })
}
