import * as http from 'node:http'
import * as https from 'node:https'

export interface CronAtSchedule {
  kind: 'at'
  at: string // ISO 8601 datetime
}

export interface CronJob {
  prompt: string
  schedule: CronAtSchedule
  label?: string
  channel?: string
}

export interface CronJobResult {
  id: string
  label?: string
}

/**
 * Creates a cron job via the OpenClaw gateway REST API.
 * Runs over HTTP/1.1 (same reason as ha-client: avoids HTTP/2 issues).
 */
export async function addCronJob(
  gatewayUrl: string,
  gatewayToken: string,
  job: CronJob,
): Promise<CronJobResult> {
  const body = JSON.stringify(job)
  const url = new URL('/api/cron/add', gatewayUrl)
  const isHttps = url.protocol === 'https:'
  const bodyBuffer = Buffer.from(body, 'utf-8')

  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuffer.byteLength,
        'Authorization': `Bearer ${gatewayToken}`,
      },
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Gateway cron API error ${res.statusCode}: ${text}`))
          return
        }
        try {
          resolve(JSON.parse(text) as CronJobResult)
        } catch {
          // Response may be empty or non-JSON on success
          resolve({ id: 'scheduled' })
        }
      })
    })

    req.on('error', reject)
    req.write(bodyBuffer)
    req.end()
  })
}
