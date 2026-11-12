import { useEffect, useState } from 'react'

/** Where the dev server says where its door for phones is (`PHONE_ADDRESS` in dev/phoneDoor.ts) */
const PHONE_ADDRESS = '/__phone-address'

/**
 * On the dev server, open on plain http, the address of its door for phones on the Wi-Fi (dev/phoneDoor.ts), once it
 * has said; none on the live site. Demo's phone button and ▶'s panel (`DemoButton`) both send their links through it, so
 * it has a file of its own (a component's file exports only components, for fast refresh)
 */
export function usePhoneDoor() {
  const [door, setDoor] = useState<string>()
  useEffect(() => {
    if (!import.meta.env.DEV || location.protocol !== 'http:') return
    let live = true
    fetch(PHONE_ADDRESS, { cache: 'no-store' })
      .then((response) => (response.ok && response.headers.get('Content-Type')?.includes('json') ? response.json() : undefined))
      .then((said?: { origin?: unknown }) => {
        if (live && typeof said?.origin === 'string') setDoor(said.origin)
      })
      // A dev server without it: the link stays as it is
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return door
}
