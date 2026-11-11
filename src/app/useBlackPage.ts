import { useEffect } from 'react'

/**
 * The page dark while Demo shows, so what opens over it (the picker's list, tooltips) is too, and black behind it, as an
 * iPhone's browser bars take (with theme-color); as it was again after
 */
export function useBlackPage() {
  useEffect(() => {
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    const background = html.style.backgroundColor
    html.classList.add('dark')
    html.style.backgroundColor = '#000'
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const color = meta?.content
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.append(meta)
    }
    meta.content = '#000000'
    // iPhone Safari zooms the page on a pinch whatever the page says; Demo pans with two fingers instead
    const noZoom = (event: Event) => event.preventDefault()
    document.addEventListener('gesturestart', noZoom)
    return () => {
      if (!wasDark) html.classList.remove('dark')
      html.style.backgroundColor = background
      if (color === undefined) meta.remove()
      else meta.content = color
      document.removeEventListener('gesturestart', noZoom)
    }
  }, [])
}
