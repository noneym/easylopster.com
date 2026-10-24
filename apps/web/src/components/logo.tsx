import Link from "next/link";

/**
 * The "claw bubble" mark: a speech bubble whose open side is a claw. Three paths: bubble, tail,
 * teeth. Teeth are dropped under 24px (favicon rule from the brand sheet: no teeth below 64 at
 * 1x, which is 16/32 tray and favicon sizes).
 */
export function ClawMark({ size = 28, teeth, className = "", title }: { size?: number; teeth?: boolean; className?: string; title?: string }) {
  const showTeeth = teeth ?? size >= 24;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} className={className} fill="currentColor">
      <path d="M62 60 L96.37 37 A42 42 0 1 0 100.57 68.87 Z" />
      <path d="M32 86 L16 108 L46 96 Z" />
      {showTeeth && <path d="M71.97 53.32 L78.62 48.87 L78.64 56.09 Z M81.95 46.65 L88.6 42.2 L88.61 49.42 Z" />}
    </svg>
  );
}

/** Nav lockup: accent mark + heavy wordmark. */
export function Logo({ href = "/", className = "", size = 26 }: { href?: string; className?: string; size?: number }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 text-fg ${className}`} aria-label="easylopster home">
      <ClawMark size={size} className="text-accent shrink-0" />
      <span className="font-[750] tracking-[-0.03em] leading-none" style={{ fontSize: Math.round(size * 0.85) }}>
        easylopster
      </span>
    </Link>
  );
}

/** App-icon tile (accent square, white mark) for avatars and empty states. */
export function ClawTile({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-grid place-items-center bg-accent text-white shrink-0 ${className}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }} aria-hidden>
      <ClawMark size={Math.round(size * 0.7)} />
    </span>
  );
}
