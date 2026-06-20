import { AGENTS, type AgentId } from "@/lib/agents/roles";
import { cn } from "@/lib/utils";

export function AgentAvatar({
  agent,
  size = 32,
  withRing = false,
}: {
  agent: AgentId;
  size?: number;
  withRing?: boolean;
}) {
  const a = AGENTS[agent];
  const px = `${size}px`;
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0",
      )}
      style={{
        width: px,
        height: px,
        background: `linear-gradient(135deg, ${a.color}33, ${a.color}11)`,
        border: `1px solid ${a.color}55`,
        fontSize: `${size * 0.5}px`,
        boxShadow: withRing
          ? `0 0 0 2px #07070A, 0 0 0 4px ${a.color}AA`
          : undefined,
      }}
      title={`${a.name} · ${a.title}`}
    >
      <span className="leading-none">{a.emoji}</span>
    </div>
  );
}

export function AgentRosterRow() {
  const ids: AgentId[] = ["mike", "emma", "bob", "alex", "iris"];
  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {ids.map((id) => {
        const a = AGENTS[id];
        return (
          <div key={id} className="flex flex-col items-center gap-2 w-28">
            <AgentAvatar agent={id} size={64} />
            <div className="text-sm font-medium text-white">{a.name}</div>
            <div className="text-xs text-[#9090A0] text-center leading-tight">{a.title}</div>
          </div>
        );
      })}
    </div>
  );
}
