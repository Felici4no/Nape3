import type { ArtKind } from "@/lib/market";

/** Flat food illustrations (inline SVG, no external images). Decorative. */
export function FoodArt({ kind, className }: { kind: ArtKind; className?: string }) {
  const common = { viewBox: "0 0 240 240", className, "aria-hidden": true as const, focusable: false as const };
  switch (kind) {
    case "acai":
      return (
        <svg {...common}>
          <ellipse cx="120" cy="214" rx="78" ry="10" fill="#000" opacity=".18" />
          <path d="M44 104h152l-18 96a16 16 0 0 1-16 13H78a16 16 0 0 1-16-13z" fill="#f3ede1" />
          <path d="M52 118h136l-4 22H56z" fill="#e3d9c6" />
          <ellipse cx="120" cy="104" rx="78" ry="22" fill="#2a0f40" />
          <path d="M60 98c10-30 110-34 120 0-20 12-100 14-120 0z" fill="#5d2a86" />
          <circle cx="94" cy="88" r="13" fill="#f6e7a8" /><circle cx="94" cy="88" r="5" fill="#e8cf6e" />
          <circle cx="118" cy="82" r="13" fill="#f6e7a8" /><circle cx="118" cy="82" r="5" fill="#e8cf6e" />
          <g fill="#c7893f">{[70, 80, 140, 152, 160, 132, 146].map((x, i) => <rect key={i} x={x} y={84 + (i % 3) * 5} width="8" height="6" rx="2" transform={`rotate(${i * 25} ${x} 90)`} />)}</g>
          <path d="M146 62c8-14 22-14 26 0-6 10-20 10-26 0z" fill="#d7322b" /><path d="M158 58l4-10" stroke="#2f7d32" strokeWidth="4" strokeLinecap="round" />
          <path d="M160 36l-14 58" stroke="#f3ede1" strokeWidth="8" strokeLinecap="round" />
        </svg>
      );
    case "burger":
      return (
        <svg {...common}>
          <ellipse cx="120" cy="214" rx="86" ry="10" fill="#000" opacity=".18" />
          <path d="M36 112c0-48 168-48 168 0z" fill="#c9792a" />
          <g fill="#f6e7a8">{[70, 96, 124, 150, 110, 84, 138].map((x, i) => <ellipse key={i} cx={x} cy={86 + (i % 2) * 10} rx="4" ry="2.4" transform={`rotate(-20 ${x} 90)`} />)}</g>
          <path d="M30 118c20 10 40-8 60 4s40-8 60 2 40-6 60 0l-4 12H34z" fill="#3fa34d" />
          <path d="M40 136h160l-10 18H50z" fill="#d7322b" />
          <path d="M34 150h172c-6 10-20 16-30 12l-10 12-14-12-16 14-14-14-18 12-12-12-20 10-10-10c-14 4-24-2-28-12z" fill="#f6c445" />
          <rect x="38" y="160" width="164" height="22" rx="10" fill="#5a3418" />
          <path d="M40 186h160c0 18-12 24-26 24H66c-14 0-26-6-26-24z" fill="#c9792a" />
        </svg>
      );
    case "pizza":
      return (
        <svg {...common}>
          <ellipse cx="120" cy="214" rx="90" ry="10" fill="#000" opacity=".18" />
          <circle cx="120" cy="120" r="92" fill="#c9792a" />
          <circle cx="120" cy="120" r="78" fill="#f6c445" />
          <path d="M120 120L120 42A78 78 0 0 1 187 82z" fill="#f3ede1" opacity=".18" />
          <g fill="#d7322b">{[[88, 88], [150, 96], [100, 150], [146, 150], [122, 116], [70, 126], [170, 128]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="13" />)}</g>
          <g fill="#2f7d32">{[[110, 80], [160, 120], [84, 116], [128, 166]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="9" ry="5" transform={`rotate(${i * 40} ${x} ${y})`} />)}</g>
          <g stroke="#c9792a" strokeWidth="3" opacity=".6"><path d="M120 42v156M42 120h156M65 65l110 110M175 65L65 175" /></g>
        </svg>
      );
    case "sushi":
      return (
        <svg {...common}>
          <ellipse cx="120" cy="214" rx="96" ry="10" fill="#000" opacity=".18" />
          <rect x="24" y="150" width="192" height="40" rx="10" fill="#2a2018" />
          {[64, 120, 176].map((x) => (
            <g key={x}>
              <rect x={x - 26} y="94" width="52" height="64" rx="12" fill="#1b2a22" />
              <ellipse cx={x} cy="96" rx="26" ry="14" fill="#fbf7ee" />
              <ellipse cx={x} cy="96" rx="13" ry="7" fill="#f28c6b" />
              <ellipse cx={x - 3} cy="94" rx="4" ry="2" fill="#ffd1bd" />
            </g>
          ))}
          <path d="M42 62c20-18 58-18 74 0-16 14-56 14-74 0z" fill="#f28c6b" />
          <path d="M56 58l52 4M58 64l46 2" stroke="#fbf7ee" strokeWidth="3" />
          <rect x="40" y="62" width="78" height="24" rx="12" fill="#fbf7ee" />
          <path d="M150 40l70 20M146 52l70 20" stroke="#c9a37a" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
  }
}
