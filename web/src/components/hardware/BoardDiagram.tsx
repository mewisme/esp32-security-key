/** Top view of a typical ESP32-S3 N16R8 devkit: where the module marking, the two USB-C connectors and BOOT/RST are. */
export function BoardDiagram({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 560 300" role="img" aria-labelledby="board-title board-desc" className="h-auto w-full text-foreground">
        <title id="board-title">ESP32-S3 N16R8 development board, top view</title>
        <desc id="board-desc">
          The metal module at the top carries the N16R8 marking. At the bottom edge are two USB-C connectors: the one labelled USB or
          OTG is the one to use; the other is labelled UART or COM. The BOOT and RST buttons sit next to the connectors.
        </desc>
        {/* board */}
        <rect x="150" y="20" width="260" height="250" rx="10" fill="var(--card)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
        {/* pin headers */}
        {Array.from({ length: 20 }, (_, i) => (
          <g key={i}>
            <circle cx="164" cy={44 + i * 11} r="3" fill="currentColor" fillOpacity="0.35" />
            <circle cx="396" cy={44 + i * 11} r="3" fill="currentColor" fillOpacity="0.35" />
          </g>
        ))}
        {/* module */}
        <rect x="200" y="34" width="160" height="120" rx="4" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.6" />
        <rect x="200" y="34" width="160" height="26" fill="currentColor" fillOpacity="0.08" />
        <text x="280" y="96" textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fill="currentColor">ESP32-S3</text>
        <text x="280" y="118" textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fontWeight="700" fill="var(--primary)">N16R8</text>
        {/* buttons */}
        <rect x="190" y="200" width="34" height="22" rx="4" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.6" />
        <circle cx="207" cy="211" r="6" fill="currentColor" fillOpacity="0.5" />
        <text x="207" y="240" textAnchor="middle" fontSize="12" fill="currentColor">BOOT</text>
        <rect x="336" y="200" width="34" height="22" rx="4" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.6" />
        <circle cx="353" cy="211" r="6" fill="currentColor" fillOpacity="0.5" />
        <text x="353" y="240" textAnchor="middle" fontSize="12" fill="currentColor">RST</text>
        {/* connectors */}
        <rect x="236" y="252" width="36" height="26" rx="6" fill="var(--primary)" fillOpacity="0.25" stroke="var(--primary)" strokeWidth="2" />
        <rect x="290" y="252" width="36" height="26" rx="6" fill="var(--muted)" stroke="currentColor" strokeOpacity="0.6" />
        {/* callouts */}
        <line x1="360" y1="108" x2="430" y2="108" stroke="currentColor" strokeOpacity="0.5" />
        <text x="436" y="104" fontSize="13" fill="currentColor">Module marking:</text>
        <text x="436" y="121" fontSize="13" fill="currentColor">N16 = 16 MB flash</text>
        <line x1="254" y1="278" x2="254" y2="292" stroke="var(--primary)" />
        <line x1="254" y1="292" x2="120" y2="292" stroke="var(--primary)" />
        <text x="10" y="270" fontSize="13" fontWeight="600" fill="var(--primary)">USB / OTG</text>
        <text x="10" y="287" fontSize="13" fontWeight="600" fill="var(--primary)">use this one</text>
        <line x1="308" y1="278" x2="308" y2="292" stroke="currentColor" strokeOpacity="0.5" />
        <line x1="308" y1="292" x2="440" y2="292" stroke="currentColor" strokeOpacity="0.5" />
        <text x="446" y="287" fontSize="13" fill="currentColor">UART / COM</text>
        <line x1="190" y1="211" x2="120" y2="211" stroke="currentColor" strokeOpacity="0.5" />
        <text x="10" y="207" fontSize="13" fill="currentColor">BOOT = the</text>
        <text x="10" y="224" fontSize="13" fill="currentColor">touch button</text>
      </svg>
      <figcaption className="mt-2 text-sm text-muted-foreground">
        Connector labels differ between boards. The right one is wired to the chip's own USB (GPIO19/20) and is usually labelled USB or OTG.
      </figcaption>
    </figure>
  );
}
