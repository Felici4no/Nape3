import { defineManifest } from "@crxjs/vite-plugin";
import packageJson from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Nape3",
  description: "Browser-assisted delivery offer observation for Nape3.",
  version: packageJson.version,
  permissions: ["activeTab", "storage"],
  host_permissions: ["https://*.ifood.com.br/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
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
