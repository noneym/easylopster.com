import Link from "next/link";

export function Logo({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 font-semibold tracking-tight text-fg ${className}`}>
      <span aria-hidden className="inline-block size-3 rounded-[3px] bg-accent" />
      <span>easylopster</span>
    </Link>
  );
}
