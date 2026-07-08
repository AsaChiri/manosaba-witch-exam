// @ts-check
import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import sitemap from '@astrojs/sitemap'

// The canonical origin. Overridden per-deploy via PUBLIC_SITE_URL so share
// URLs, canonicals, OG image URLs and the sitemap all agree. Placeholder
// until the owner provisions a domain (design spec §9).
const SITE = process.env.PUBLIC_SITE_URL || 'https://manosaba-exam.pages.dev'

// Locale route scheme (design spec §4): zh-CN lives at the bare root; every
// other locale gets a path prefix. Astro's key for zh-TW is lowercase
// `zh-tw` (it becomes the `/zh-tw/` segment); our catalog key is `zh-TW`.
export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: {
    defaultLocale: 'zh-cn',
    locales: ['zh-cn', 'en', 'ja', 'zh-tw'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    vue(),
    sitemap({
      i18n: {
        defaultLocale: 'zh-cn',
        locales: {
          'zh-cn': 'zh-CN',
          en: 'en',
          ja: 'ja',
          'zh-tw': 'zh-TW',
        },
      },
    }),
  ],
  vite: {
    resolve: {
      // Vue 3.5 ships a hydration-friendly runtime; nothing custom needed,
      // but we keep dedupe so the island and any future SFC deps share one Vue.
      dedupe: ['vue'],
    },
  },
})
