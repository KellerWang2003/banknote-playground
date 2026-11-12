import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Demo on a phone from the dev server (Keller, 11 November: "make it so that my loalhost can do LAN so that when im on
 * local, the link on my phone still works"). The dev server answers on the Wi-Fi as well as on localhost (`server.host`
 * in vite.config.ts), and beside it this opens a door for phones: the same dev server over https, at its port + 1000, as
 * an iPhone gives its motion only to an https page. The door's certificate is the dev server's own, made with openssl
 * and kept in Vite's cache folder, so a phone warns about it the first time (This Connection Is Not Private: Show
 * Details, then visit this website). Demo's phone button, on a page open on plain http (localhost, which on a phone is
 * the phone itself, or the Wi-Fi's own address), asks `PHONE_ADDRESS` where the door is on the Wi-Fi, and its QR code
 * and link go there (`PhoneLink`).
 */

/** Where Demo's phone button asks for the door (`PHONE_ADDRESS` in src/app/PhoneLink.tsx says the same) */
export const PHONE_ADDRESS = '/__phone-address'

/** The door's port, past the dev server's own: each dev server has its own port, so each has its own door */
export const DOOR_OFFSET = 1000

/** Interfaces that aren't the network a phone is on: VPNs, virtual machines' and containers' bridges, Apple's peer links */
const NOT_LAN = /^(lo|utun|tun|tap|ppp|ipsec|wg|tailscale|zt|bridge|vmnet|vmenet|docker|br-|veth|virbr|awdl|llw|anpi|gif|stf)/

const isPrivate = (address: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)

/** The Mac's address for a phone on the same network: IPv4 on the Wi-Fi or a cable, a home or office (private) one first */
export function lanAddress(interfaces: ReturnType<typeof networkInterfaces>): string | undefined {
  const found = Object.entries(interfaces).flatMap(([name, infos]) => NOT_LAN.test(name) ? [] : (infos ?? [])
    // Node 18.0 to 18.3 gave the family as a number
    .filter((info) => (info.family === 'IPv4' || (info.family as unknown) === 4) && !info.internal && !info.address.startsWith('169.254.'))
    .map((info) => ({ name, address: info.address })))
  const rank = ({ name, address }: { name: string; address: string }) => (/^(en|eth|wl)/.test(name) ? 0 : 2) + (isPrivate(address) ? 0 : 1)
  return found.sort((a, b) => rank(a) - rank(b))[0]?.address
}

const DAY_MS = 86_400_000

/**
 * The door's certificate and key: made with openssl the first time and kept, so a phone that has let it through isn't
 * warned again, and made again after a year. It names the address it was made on; shown on another, a phone only warns
 * once more
 */
function certificate(folder: string, address: string | undefined) {
  const key = path.join(folder, 'key.pem')
  const cert = path.join(folder, 'cert.pem')
  if (!existsSync(key) || !existsSync(cert) || Date.now() - statSync(cert).mtimeMs > 365 * DAY_MS) {
    mkdirSync(folder, { recursive: true })
    const config = path.join(folder, 'openssl.cnf')
    // What an iPhone asks of every certificate, even one it is told to let through: its names in subjectAltName, made
    // for serving (serverAuth), RSA of 2048 bits signed with SHA-256, valid for less than 825 days
    writeFileSync(config, [
      '[req]', 'prompt = no', 'distinguished_name = dn', 'x509_extensions = door',
      '[dn]', 'CN = Banknote Playground dev server',
      '[door]', 'basicConstraints = critical, CA:FALSE', 'keyUsage = critical, digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth', `subjectAltName = DNS:localhost, IP:127.0.0.1${address ? `, IP:${address}` : ''}`,
      '',
    ].join('\n'))
    execFileSync('openssl', ['req', '-x509', '-config', config, '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '397', '-keyout', key, '-out', cert], { stdio: 'pipe' })
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

/** Whether the dev server answers on every network it is on, the Wi-Fi among them (`server.host`), not only on this computer */
const everywhere = (address: AddressInfo | null) => address?.address === '::' || address?.address === '0.0.0.0'

/**
 * The door for phones beside the dev server, and where Demo's phone button asks for it (see above). Only while the dev
 * server answers on the Wi-Fi: one kept to this computer (`vite --host localhost`) gets none
 */
export function phoneDoor({ offset = DOOR_OFFSET }: {
  /** The door's port, past the dev server's own (a test's own pick) */
  offset?: number
} = {}): Plugin {
  return {
    name: 'phone-door',
    apply: 'serve',
    configureServer(server) {
      const { httpServer, config } = server
      // Inside another server (Vitest's, say) there is no server of its own to open a door beside
      if (!httpServer) return
      const own = () => httpServer.address() as AddressInfo | null
      let doorPort: number | undefined
      let closed = false
      httpServer.once('close', () => {
        closed = true
      })

      server.middlewares.use(PHONE_ADDRESS, (_req, res) => {
        const address = everywhere(own()) ? lanAddress(networkInterfaces()) : undefined
        // Without its door (no openssl), the dev server itself on the Wi-Fi: a phone opens it, though an iPhone gives
        // plain http no motion, and dragging stands in
        const origin = !address ? undefined : doorPort ? `https://${address}:${doorPort}` : `http://${address}:${own()?.port}`
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(origin ? { origin } : {}))
      })

      httpServer.once('listening', () => {
        const at = own()
        if (!at || !everywhere(at) || closed) return
        const port = at.port + offset
        if (port < 1 || port > 65535) {
          config.logger.warn(`Phone door: no port ${port}, past the dev server's ${at.port}`)
          return
        }
        let tls
        try {
          tls = certificate(path.join(config.cacheDir, 'phone-door'), lanAddress(networkInterfaces()))
        } catch (error) {
          config.logger.warn(`Phone door: openssl couldn't make its certificate (${String(error).split('\n')[0]}), so phones get plain http, where an iPhone gives no motion`)
          return
        }
        const door = createServer(tls, server.middlewares)
        // Live reload over the door's own connection, to the dev server's
        door.on('upgrade', (req, socket, head) => httpServer.emit('upgrade', req, socket, head))
        let tries = 0
        door.on('error', (error: NodeJS.ErrnoException) => {
          // After a restart, the old door can still be letting go of the port
          if (error.code === 'EADDRINUSE' && ++tries < 10) {
            setTimeout(() => closed || door.listen(port), 200)
            return
          }
          config.logger.warn(`Phone door: ${error.message}`)
        })
        door.listen(port, () => {
          if (closed) return void door.close()
          doorPort = port
          config.logger.info(`  ➜  Phone:   https://${lanAddress(networkInterfaces()) ?? 'localhost'}:${port}/`)
        })
        httpServer.once('close', () => {
          doorPort = undefined
          door.close()
          door.closeAllConnections()
        })
      })
    },
  }
}
