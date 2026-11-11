import path from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Connect, type Plugin } from 'vite'

/**
 * Intaglio Studio is its own page, intaglio/index.html: at /intaglio, without the slash, Vite would serve Banknote
 * Playground's page instead (vercel.json does the same for the live site)
 */
function intaglioPage(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [pathname, query] = (req.url ?? '').split('?')
    if (pathname === '/intaglio') req.url = `/intaglio/index.html${query ? `?${query}` : ''}`
    next()
  }
  return {
    name: 'intaglio-page',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    intaglioPage(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Demo on a phone while developing: the phone needs https for its motion, so the dev server is opened through a
  // Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5174`), whose address Vite would otherwise refuse
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        intaglio: path.resolve(import.meta.dirname, 'intaglio/index.html'),
      },
    },
  },
})
