import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page site:
//   /                     Acolyte landing page
//   /automation-index/    SA Automation Opportunity Index dashboard (?report = printable)
//   /privacy/             POPIA privacy notice
//   /employers/           Who is hiring (company profiles)
//   /tools/               Tools & skills in demand
//   /analyst/             Acolyte Analyst: chat with the data (talks to analyst/server.py)
//   /crm/                 Private CRM: talks to crm/server.py on your own computer
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
        employers: "employers/index.html",
        tools: "tools/index.html",
        crm: "crm/index.html",
        analyst: "analyst/index.html",
      },
    },
  },
});
