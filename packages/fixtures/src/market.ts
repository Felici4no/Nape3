import type { MarketObservation } from "@nape3/domain";
import { acaiFixtures, cartObservation, FIXTURE_NOW, type CartSpec } from "./acai";

/**
 * SYNTHETIC market fixtures for the web Food Market demo: açaí, burger,
 * pizza and sushi across iFood / Rappi / 99Food. Invented, deterministic
 * numbers (merchants are fictitious), every record marked
 * provenance { method: "fixture", synthetic: true, live: false }.
 *
 * Includes a "previous" set ~24 h earlier so price movement can be shown
 * for açaí, burger and pizza. Sushi deliberately has too little history:
 * the UI must show no movement for it rather than invent one.
 */

const H = 60;
const prev = (minutes: number) => 24 * H + minutes;

const SPECS: CartSpec[] = [
  // ---- burger (single, no sides) -------------------------------------------
  { id: "fx-burger-ifood-1", source: "ifood", merchant: "Brasa Burger (fictício)", lines: [{ title: "X-Burger artesanal", unit: 2890 }], delivery: 599, service: 99, minutesAgo: 12, eta: [35, 45] },
  { id: "fx-burger-rappi-1", source: "rappi", merchant: "Smash Club (fictício)", lines: [{ title: "Smash burger", unit: 2490 }], delivery: 499, service: 0, minutesAgo: 20, eta: [30, 40] },
  { id: "fx-burger-99-1", source: "99food", merchant: "Lanchonete Central (fictício)", lines: [{ title: "Cheeseburger clássico", unit: 2290 }], delivery: 399, service: 70, minutesAgo: 9, eta: [25, 35] },
  { id: "fx-burger-ifood-2", source: "ifood", merchant: "Burger da Vila (fictício)", lines: [{ title: "Burger da casa", unit: 3190 }], delivery: 0, service: 99, minutesAgo: 41, eta: [40, 55] },
  { id: "fx-burger-rappi-2", source: "rappi", merchant: "X da Esquina (fictício)", lines: [{ title: "X-Salada", unit: 1990 }], delivery: 699, service: 0, discount: 500, minutesAgo: 27, promotionScope: "public", eta: [30, 45] },
  { id: "fx-burger-99-rj", source: "99food", merchant: "Burger Carioca (fictício)", lines: [{ title: "X-Burger", unit: 2400 }], delivery: 300, service: 50, minutesAgo: 15, region: "BR-RJ-rio-de-janeiro", eta: [30, 40] },
  { id: "fx-burger-combo", source: "ifood", merchant: "Brasa Burger (fictício)", lines: [{ title: "Combo X-Burger + batata + refri", unit: 3990 }], delivery: 599, service: 99, minutesAgo: 14, eta: [35, 45] },
  // previous day
  { id: "fx-burger-prev-1", source: "ifood", merchant: "Brasa Burger (fictício)", lines: [{ title: "X-Burger artesanal", unit: 2990 }], delivery: 599, service: 99, minutesAgo: prev(20) },
  { id: "fx-burger-prev-2", source: "rappi", merchant: "Smash Club (fictício)", lines: [{ title: "Smash burger", unit: 2690 }], delivery: 499, service: 0, minutesAgo: prev(35) },
  { id: "fx-burger-prev-3", source: "99food", merchant: "Lanchonete Central (fictício)", lines: [{ title: "Cheeseburger clássico", unit: 2490 }], delivery: 399, service: 70, minutesAgo: prev(50) },
  { id: "fx-burger-prev-4", source: "ifood", merchant: "Burger da Vila (fictício)", lines: [{ title: "Burger da casa", unit: 3290 }], delivery: 0, service: 99, minutesAgo: prev(65) },

  // ---- pizza grande ----------------------------------------------------------
  { id: "fx-pizza-ifood-1", source: "ifood", merchant: "Forno Paulista (fictício)", lines: [{ title: "Pizza Grande Calabresa (8 fatias)", unit: 5490 }], delivery: 799, service: 99, minutesAgo: 18, eta: [45, 60] },
  { id: "fx-pizza-rappi-1", source: "rappi", merchant: "Pizzaria Bella (fictício)", lines: [{ title: "Pizza grande margherita", unit: 4990 }], delivery: 599, service: 0, minutesAgo: 33, eta: [40, 55] },
  { id: "fx-pizza-99-1", source: "99food", merchant: "Disk Pizza (fictício)", lines: [{ title: "Pizza grande mussarela", unit: 4590 }], delivery: 499, service: 70, minutesAgo: 11, eta: [35, 50] },
  { id: "fx-pizza-ifood-2", source: "ifood", merchant: "Cantina do Bairro (fictício)", lines: [{ title: "Pizza grande portuguesa", unit: 5990 }], delivery: 0, service: 99, discount: 1000, minutesAgo: 52, promotionScope: "account-specific", membership: "ifood-club", eta: [50, 65] },
  { id: "fx-pizza-broto", source: "rappi", merchant: "Pizzaria Bella (fictício)", lines: [{ title: "Pizza broto mussarela", unit: 2990 }], delivery: 599, service: 0, minutesAgo: 22, eta: [40, 55] },
  // previous day
  { id: "fx-pizza-prev-1", source: "ifood", merchant: "Forno Paulista (fictício)", lines: [{ title: "Pizza Grande Calabresa (8 fatias)", unit: 5090 }], delivery: 799, service: 99, minutesAgo: prev(25) },
  { id: "fx-pizza-prev-2", source: "rappi", merchant: "Pizzaria Bella (fictício)", lines: [{ title: "Pizza grande margherita", unit: 4590 }], delivery: 599, service: 0, minutesAgo: prev(40) },
  { id: "fx-pizza-prev-3", source: "99food", merchant: "Disk Pizza (fictício)", lines: [{ title: "Pizza grande mussarela", unit: 4190 }], delivery: 499, service: 70, minutesAgo: prev(55) },

  // ---- sushi 20 peças (no usable history on purpose) -------------------------
  { id: "fx-sushi-ifood-1", source: "ifood", merchant: "Sushi Bar Liberdade (fictício)", lines: [{ title: "Combinado 20 peças", unit: 6990 }], delivery: 899, service: 99, minutesAgo: 16, eta: [50, 70] },
  { id: "fx-sushi-rappi-1", source: "rappi", merchant: "Kaizen Sushi (fictício)", lines: [{ title: "Sushi combo 20 pcs", unit: 5990 }], delivery: 799, service: 0, minutesAgo: 29, eta: [45, 60] },
  { id: "fx-sushi-99-1", source: "99food", merchant: "Temakeria Sol (fictício)", lines: [{ title: "Combinado 20 peças salmão", unit: 6490 }], delivery: 599, service: 70, minutesAgo: 38, eta: [40, 60] },
  { id: "fx-sushi-30", source: "ifood", merchant: "Sushi Bar Liberdade (fictício)", lines: [{ title: "Combinado 30 peças", unit: 9490 }], delivery: 899, service: 99, minutesAgo: 16, eta: [50, 70] },
  { id: "fx-sushi-temaki", source: "rappi", merchant: "Kaizen Sushi (fictício)", lines: [{ title: "Temaki salmão", unit: 3290 }], delivery: 799, service: 0, minutesAgo: 29, eta: [45, 60] },
  { id: "fx-sushi-prev-1", source: "ifood", merchant: "Sushi Bar Liberdade (fictício)", lines: [{ title: "Combinado 20 peças", unit: 6790 }], delivery: 899, service: 99, minutesAgo: prev(30) },

  // ---- açaí 500 ml history (current set comes from acaiFixtures) -------------
  { id: "fx-acai-prev-1", source: "ifood", merchant: "Açaí do Bairro (fictício)", lines: [{ title: "Açaí 500ml Tradicional", unit: 1690 }], delivery: 499, service: 99, minutesAgo: prev(15) },
  { id: "fx-acai-prev-2", source: "rappi", merchant: "Point do Açaí (fictício)", lines: [{ title: "Açaí 500 ml c/ granola", unit: 1790 }], delivery: 399, service: 0, minutesAgo: prev(30) },
  { id: "fx-acai-prev-3", source: "99food", merchant: "Tropical Açaí (fictício)", lines: [{ title: "AÇAÍ 500ML", unit: 1850 }], delivery: 299, service: 70, minutesAgo: prev(45) },
  { id: "fx-acai-prev-4", source: "ifood", merchant: "Casa do Açaí (fictício)", lines: [{ title: "Copo de Açaí 0,5L", unit: 1990 }], delivery: 599, service: 99, minutesAgo: prev(60) }
];

/** All synthetic market observations, timestamps relative to `now`. */
export function marketFixtures(now: Date = FIXTURE_NOW): MarketObservation[] {
  return [...acaiFixtures(now), ...SPECS.map((spec) => cartObservation(spec, now))];
}
