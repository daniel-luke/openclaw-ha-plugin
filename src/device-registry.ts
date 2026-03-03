import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

export interface DeviceEntry {
  entity_id: string
  name: string
  room: string | null
  enabled: boolean
}

interface YamlDeviceEntry {
  entity_id: string
  name?: string
  enabled?: boolean
  room?: string | null
}

interface YamlDeviceFile {
  room?: string | null
  devices: YamlDeviceEntry[]
}

export class DeviceRegistry {
  private devices: Map<string, DeviceEntry> = new Map()
  private loaded = false

  constructor(private readonly haDir: string) {}

  async load(): Promise<void> {
    this.devices.clear()

    if (!fs.existsSync(this.haDir)) {
      this.loaded = true
      return
    }

    const files = fs
      .readdirSync(this.haDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.haDir, file), 'utf-8')
        const data = yaml.load(content) as YamlDeviceFile
        if (!data?.devices || !Array.isArray(data.devices)) continue

        const fileRoom = data.room ?? null

        for (const device of data.devices) {
          if (!device.entity_id) continue
          this.devices.set(device.entity_id, {
            entity_id: device.entity_id,
            name: device.name ?? device.entity_id,
            room: device.room !== undefined ? (device.room ?? null) : fileRoom,
            enabled: device.enabled !== false,
          })
        }
      } catch (err) {
        console.warn(`[ha-plugin] Failed to load ${file}:`, err)
      }
    }

    this.loaded = true
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  reload(): Promise<void> {
    this.loaded = false
    return this.load()
  }

  getDevice(entityId: string): DeviceEntry | undefined {
    return this.devices.get(entityId)
  }

  getAllDevices(): DeviceEntry[] {
    return Array.from(this.devices.values())
  }

  getEnabledDevices(): DeviceEntry[] {
    return this.getAllDevices().filter((d) => d.enabled)
  }

  isEnabled(entityId: string): boolean {
    const device = this.devices.get(entityId)
    // Unknown devices (not in registry) are allowed through — registry is opt-out
    if (!device) return true
    return device.enabled
  }

  hasDevices(): boolean {
    return this.devices.size > 0
  }

  buildContextBlock(): string {
    const enabled = this.getEnabledDevices()
    if (enabled.length === 0) return ''

    const byRoom = new Map<string, DeviceEntry[]>()
    for (const device of enabled) {
      const room = device.room ?? 'Unassigned'
      if (!byRoom.has(room)) byRoom.set(room, [])
      byRoom.get(room)!.push(device)
    }

    const lines: string[] = ['[Home Assistant Devices]']
    for (const [room, devices] of byRoom) {
      const deviceList = devices.map((d) => `${d.name} (${d.entity_id})`).join(', ')
      lines.push(`${room}: ${deviceList}`)
    }

    return lines.join('\n')
  }
}
