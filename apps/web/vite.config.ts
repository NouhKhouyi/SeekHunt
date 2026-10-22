import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `--mode phone` serves over HTTPS on the LAN: phones only expose GPS and camera to secure pages.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "phone" ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      // PNG icons (incl. the 180px apple-touch-icon iOS needs) generated from the SVG logo.
      pwaAssets: { image: "public/icon.svg", preset: "minimal-2023", overrideManifestIcons: true },
      manifest: {
        name: "SeekHunt",
        short_name: "SeekHunt",
        description: "Escondite por GPS con una zona que se cierra.",
        lang: "es",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#121417",
        theme_color: "#121417",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,ico,woff2}"],
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Map tiles and styles: patchy mobile data in the middle of a game shouldn't blank the map.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "map-tiles", expiration: { maxEntries: 3000, maxAgeSeconds: 7 * 24 * 3600 } },
          },
          {
            urlPattern: /\.wasm$/,
            handler: "CacheFirst",
            options: { cacheName: "wasm", expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  // MapLibre v6 loads its web worker relative to its own module URL; pre-bundling breaks that path.
  optimizeDeps: { exclude: ["maplibre-gl", "barcode-detector", "zxing-wasm"] },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
}));
