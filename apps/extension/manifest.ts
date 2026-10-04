import { defineManifest } from "@crxjs/vite-plugin";
import packageJson from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "UPAY3FOOD.agent",
  description: "Observes delivery prices you see on iFood and compares your checkout with recent market observations.",
  version: packageJson.version,
  // storage: local observations/settings. activeTab/tabs: read the active tab URL and reload it on request.
  permissions: ["storage", "activeTab"],
  host_permissions: ["https://*.ifood.com.br/*"],
  // Requested at runtime only if the user configures an observation network endpoint.
  optional_host_permissions: ["http://localhost/*", "https://*/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  // Only the UPAY3FOOD Pay page (wallet connection lives there: wallets do not
  // inject into extension pages) may message the extension. The background also
  // checks the sender origin against settings.fundingAppUrl.
  externally_connectable: {
    matches: ["http://localhost/*", "http://127.0.0.1/*"]
  },
  action: {
    default_popup: "src/popup/index.html"
  },
  content_scripts: [
    {
      matches: ["https://*.ifood.com.br/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
});
