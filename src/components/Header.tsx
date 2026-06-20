import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#07070A]/70 border-b border-[#23232E]">
      <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-bold">
            ⚛︎
          </span>
          <span className="font-semibold tracking-tight text-white">Atoms</span>
          <span className="text-[10px] uppercase tracking-widest text-[#9090A0] px-1.5 py-0.5 rounded bg-[#14141C] border border-[#23232E]">
            Demo
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-[#9090A0]">
          <Link href="/" className="hover:text-white">Home</Link>
          <a href="https://help.atoms.dev/en" target="_blank" rel="noreferrer" className="hover:text-white">
            Docs ↗
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm bg-white text-black px-3.5 py-1.5 rounded-md font-medium hover:bg-zinc-100 transition-colors"
          >
            New project →
          </Link>
        </div>
      </div>
    </header>
  );
}
