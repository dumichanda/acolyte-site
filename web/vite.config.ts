import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page site:
//   /                     Acolyte landing page
//   /automation-index/    SA Automation Opportunity Index dashboard (?report = printable)
//   /privacy/             POPIA privacy notice
export default defineConfig({
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
