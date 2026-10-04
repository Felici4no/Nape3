import { createServer } from "node:http";
import { createApp } from "./app";
import { JsonlStore } from "./store";

const port = Number(process.env.PORT ?? 8787);
const dataFile = process.env.OBSERVATIONS_FILE ?? new URL("../data/observations.jsonl", import.meta.url).pathname;

createServer(createApp(new JsonlStore(dataFile))).listen(port, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "observer-api", event: "listening", port, dataFile }));
});
