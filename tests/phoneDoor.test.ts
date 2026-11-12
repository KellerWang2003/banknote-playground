import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import { lanAddress, PHONE_ADDRESS, phoneDoor } from '../dev/phoneDoor'

type Interfaces = ReturnType<typeof networkInterfaces>
const ipv4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null })
const ipv6 = (address: string) => ({ address, family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: null, scopeid: 0 })

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createNetServer().once('error', reject).listen(0, () => {
    const { port } = probe.address() as AddressInfo
    probe.close(() => resolve(port))
  })
})

/** A request to the door, letting its own certificate through as a phone is told to */
function throughDoor(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const sent = request(url, { rejectUnauthorized: false, headers }, (response) => {
      let body = ''
      response.setEncoding('utf8').on('data', (chunk) => (body += chunk)).on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    sent.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode ?? 0, body: '' })
    })
    sent.on('error', reject).end()
  })
}

describe('the dev server’s door for phones', () => {
  it('finds the Mac on the Wi-Fi, not on a VPN, a virtual machine’s bridge or a link-local address', () => {
    const interfaces = {
      lo0: [ipv4('127.0.0.1', true)],
      utun4: [ipv4('100.101.102.103')],
      bridge100: [ipv4('192.168.64.1')],
      awdl0: [ipv6('fe80::1')],
      en5: [ipv4('169.254.10.2')],
      en7: [ipv4('203.0.113.9')],
      en0: [ipv6('fe80::2'), ipv4('192.168.1.23')],
    } as Interfaces
    expect(lanAddress(interfaces)).toBe('192.168.1.23')
    // A public address on the Wi-Fi still beats none
    expect(lanAddress({ en7: interfaces.en7, utun4: interfaces.utun4 } as Interfaces)).toBe('203.0.113.9')
    expect(lanAddress({ lo0: interfaces.lo0, utun4: interfaces.utun4 } as Interfaces)).toBeUndefined()
  })

  it('opens beside the dev server over https, for the page, its live reload, and where Demo asks for it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'phone-door-'))
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Door</title>')
    const port = await freePort()
    const doorPort = await freePort()
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, '.vite'),
      logLevel: 'silent',
      plugins: [phoneDoor({ offset: doorPort - port })],
      server: { host: true, port, strictPort: true },
    })
    await server.listen()
    try {
      // The certificate is made, then the door opens, just after the dev server
      let page: { status: number; body: string } | undefined
      for (let tries = 0; !page; tries++) {
        try {
          page = await throughDoor(`https://127.0.0.1:${doorPort}/`)
        } catch (error) {
          if (tries > 200) throw error
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      expect(page.status).toBe(200)
      expect(page.body).toContain('/@vite/client')
      // Live reload's websocket, through the door to the dev server's own
      const reload = await throughDoor(`https://127.0.0.1:${doorPort}/?token=${server.config.webSocketToken}`, {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Protocol': 'vite-hmr',
      })
      expect(reload.status).toBe(101)

      // Demo's phone button, on the dev server's own address, is told where the door is on the Wi-Fi
      const address = lanAddress(networkInterfaces())
      expect(await (await fetch(`http://127.0.0.1:${port}${PHONE_ADDRESS}`)).json()).toEqual(address ? { origin: `https://${address}:${doorPort}` } : {})
    } finally {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stays shut for a dev server kept to this computer', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'phone-door-'))
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Door</title>')
    const port = await freePort()
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, '.vite'),
      logLevel: 'silent',
      plugins: [phoneDoor()],
      server: { host: '127.0.0.1', port, strictPort: true },
    })
    await server.listen()
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}${PHONE_ADDRESS}`)).json()).toEqual({})
    } finally {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
