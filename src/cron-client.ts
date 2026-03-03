import { randomUUID } from 'node:crypto'
import WS from 'ws'

export interface CronAtSchedule {
  kind: 'at'
  at: string // ISO 8601 datetime, e.g. "2026-06-01T23:00:00Z"
}

export interface CronJob {
  name: string
  schedule: CronAtSchedule
  sessionTarget: 'isolated'
  payload: {
    kind: 'agentTurn'
    message: string
  }
  delivery?: {
    mode: 'announce' | 'none'
    channel?: string
  }
  deleteAfterRun?: boolean
  description?: string
}

export interface CronJobResult {
  id: string
  name?: string
}

/**
 * Adds a cron job via the OpenClaw gateway WebSocket RPC protocol.
 *
 * Protocol:
 *   1. Connect to ws://127.0.0.1:<port>
 *   2. Send connect handshake: { type: "connect", token: "..." }
 *   3. Wait for acknowledgement from the gateway
 *   4. Send RPC request:  { type: "req", id: "<uuid>", method: "cron.add", params: <job> }
 *   5. Receive response:  { type: "res", id: "<uuid>", ok: true, payload: <result> }
 */
export async function addCronJob(
  gatewayPort: number | string,
  gatewayToken: string,
  job: CronJob,
): Promise<CronJobResult> {
  const wsUrl = `ws://127.0.0.1:${gatewayPort}`

  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl)
    const reqId = randomUUID()
    let handshakeDone = false

    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Timeout: cron.add did not complete within 10 seconds'))
    }, 10000)

    ws.on('open', () => {
      // Step 1: send connect/auth handshake
      ws.send(JSON.stringify({ type: 'connect', token: gatewayToken }))
    })

    ws.on('message', (raw: WS.RawData) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>
      } catch {
        return // ignore unparseable frames
      }

      if (!handshakeDone) {
        // Any message back after the connect handshake means we're authenticated.
        // If the gateway rejects the token it will close the connection instead.
        handshakeDone = true
        ws.send(
          JSON.stringify({
            type: 'req',
            id: reqId,
            method: 'cron.add',
            params: job,
          }),
        )
        return
      }

      // Wait for the response matching our request id
      if (msg.id === reqId) {
        clearTimeout(timeout)
        ws.close()
        if (msg.ok) {
          resolve((msg.payload as CronJobResult) ?? { id: 'scheduled' })
        } else {
          reject(new Error(`cron.add failed: ${JSON.stringify(msg.error)}`))
        }
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Gateway WebSocket error: ${err.message}`))
    })

    ws.on('close', (code, reason) => {
      if (!handshakeDone) {
        clearTimeout(timeout)
        reject(
          new Error(
            `Gateway closed connection before handshake (code ${code}: ${reason}). ` +
            'Check that OPENCLAW_GATEWAY_TOKEN is correct.',
          ),
        )
      }
    })
  })
}
