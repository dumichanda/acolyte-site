import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page site:
//   /                     Acolyte landing page
//   /automation-index/    SA Automation Opportunity Index dashboard (?report = printable)
//   /privacy/             POPIA privacy notice
// BASE_PATH: "/acolyte-site/" on GitHub Pages (set by the deploy workflow), "/" on a custom domain or locally.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        index: "automation-index/index.html",
        privacy: "privacy/index.html",
      },
    },
  },
});
