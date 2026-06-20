export type AgentId = "mike" | "emma" | "bob" | "alex" | "iris" | "user" | "system";

export interface AgentRole {
  id: AgentId;
  name: string;
  title: string;
  emoji: string;
  color: string;
  blurb: string;
}

export const AGENTS: Record<AgentId, AgentRole> = {
  mike: {
    id: "mike",
    name: "Mike",
    title: "Team Lead",
    emoji: "🧭",
    color: "#7C5CFF",
    blurb: "Coordinates the team, asks for your approval at key checkpoints.",
  },
  emma: {
    id: "emma",
    name: "Emma",
    title: "Product Manager",
    emoji: "📝",
    color: "#FF6CC7",
    blurb: "Turns your idea into a crisp PRD and task list.",
  },
  bob: {
    id: "bob",
    name: "Bob",
    title: "Architect",
    emoji: "🧱",
    color: "#39C5BB",
    blurb: "Picks the stack, sketches the data model.",
  },
  alex: {
    id: "alex",
    name: "Alex",
    title: "Engineer",
    emoji: "⚡",
    color: "#FFB23F",
    blurb: "Writes the code, file by file.",
  },
  iris: {
    id: "iris",
    name: "Iris",
    title: "Researcher",
    emoji: "🔭",
    color: "#5BC0EB",
    blurb: "Validates ideas with web research.",
  },
  user: {
    id: "user",
    name: "You",
    title: "Founder",
    emoji: "👤",
    color: "#A1A1AA",
    blurb: "",
  },
  system: {
    id: "system",
    name: "Atoms",
    title: "System",
    emoji: "⚛︎",
    color: "#52525B",
    blurb: "",
  },
};

export const ROSTER: AgentId[] = ["mike", "emma", "bob", "alex", "iris"];
