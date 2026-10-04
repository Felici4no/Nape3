import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MarketObservation } from "@nape3/domain";

export interface ObservationStore {
  /** Returns false when an observation with the same id already exists. */
  add(observation: MarketObservation): Promise<boolean>;
  all(): Promise<MarketObservation[]>;
}

export class MemoryStore implements ObservationStore {
  protected readonly byId = new Map<string, MarketObservation>();
  async add(observation: MarketObservation) {
    if (this.byId.has(observation.id)) return false;
    this.byId.set(observation.id, observation);
    return true;
  }
  async all() {
    return [...this.byId.values()];
  }
}

/** Append-only JSON Lines file. Fine for a demo; not a production database. */
export class JsonlStore extends MemoryStore {
  private loaded = false;
  constructor(private readonly path: string) {
    super();
  }
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      for (const line of (await readFile(this.path, "utf8")).split("\n")) {
        if (line.trim()) {
          const observation = JSON.parse(line) as MarketObservation;
          this.byId.set(observation.id, observation);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  override async add(observation: MarketObservation) {
    await this.load();
    if (!(await super.add(observation))) return false;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(observation)}\n`);
    return true;
  }
  override async all() {
    await this.load();
    return super.all();
  }
}
