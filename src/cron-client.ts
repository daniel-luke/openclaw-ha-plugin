import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CronJobOptions {
  name: string
  at: string // ISO 8601 datetime, e.g. "2026-06-01T23:00:00Z"
  message: string
  deleteAfterRun?: boolean
  announceChannel?: string
}

export interface CronJobResult {
  id: string
}

/**
 * Adds a one-shot cron job by invoking `openclaw cron add` via the CLI.
 * This works because the plugin runs inside the OpenClaw server environment.
 */
export async function addCronJob(options: CronJobOptions): Promise<CronJobResult> {
  const args = [
    'cron', 'add',
    '--name', options.name,
    '--at', options.at,
    '--session', 'isolated',
    '--message', options.message,
  ]

  if (options.deleteAfterRun) {
    args.push('--delete-after-run')
  }

  if (options.announceChannel) {
    args.push('--announce', '--channel', options.announceChannel)
  }

  const { stdout } = await execFileAsync('openclaw', args)

  // Try to parse a job ID from the output (e.g. JSON or "Job ID: <id>")
  const trimmed = stdout.trim()
  try {
    const parsed = JSON.parse(trimmed) as { id?: string }
    if (parsed.id) return { id: parsed.id }
  } catch {
    // Not JSON — extract ID from common text patterns like "id: abc123"
    const match = trimmed.match(/\bid[:\s]+([a-zA-Z0-9_-]+)/i)
    if (match) return { id: match[1] }
  }

  // Fall back to using the full output as a reference
  return { id: trimmed || 'scheduled' }
}
