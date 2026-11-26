import * as Schema from "effect/Schema";
import { msg } from "gt-react";
import {
  ProjectMonogramText,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { lucideIconNames } from "./lib/lucideIconByName";
import { deriveProjectIdentity } from "./projectIdentity";
export { PROJECT_ICON_COLORS, projectIconColorClassName } from "./projectIconColors";

const isProjectMonogramText = Schema.is(ProjectMonogramText);

export const PROJECT_ICON_CATEGORIES: ReadonlyArray<{
  readonly label: string;
  readonly icons: ReadonlyArray<string>;
}> = [
  {
    label: msg("Work", { $context: "icon category, project icon picker" }),
    icons: [
      "briefcase",
      "kanban",
      "list-todo",
      "clipboard-list",
      "calendar",
      "target",
      "flag",
      "trophy",
      "presentation",
      "chart-line",
      "chart-pie",
      "users",
      "message-square",
      "mail",
      "inbox",
      "megaphone",
      "handshake",
    ],
  },
  {
    label: msg("Code", { $context: "icon category, project icon picker" }),
    icons: [
      "folder-code",
      "code-2",
      "terminal",
      "braces",
      "bug",
      "git-branch",
      "git-pull-request",
      "git-merge",
      "git-commit-horizontal",
      "server",
      "database",
      "cpu",
      "bot",
      "sparkles",
      "workflow",
      "blocks",
      "puzzle",
      "cloud-cog",
    ],
  },
  {
    label: msg("Files", { $context: "icon category, project icon picker" }),
    icons: [
      "folder",
      "folder-open",
      "folder-git-2",
      "file",
      "file-text",
      "file-code",
      "files",
      "archive",
      "book-open",
      "notebook-pen",
      "bookmark",
      "image",
      "paperclip",
      "package",
    ],
  },
  {
    label: msg("Status", { $context: "icon category, project icon picker" }),
    icons: [
      "circle-check",
      "circle-alert",
      "circle-dot",
      "clock",
      "hourglass",
      "timer",
      "eye",
      "shield-check",
      "lock",
      "flame",
      "zap",
      "star",
      "heart",
      "pin",
      "bell",
    ],
  },
  {
    label: msg("Objects", { $context: "icon category, project icon picker" }),
    icons: [
      "rocket",
      "wrench",
      "cog",
      "lightbulb",
      "flask-conical",
      "key",
      "palette",
      "pen-tool",
      "camera",
      "music",
      "gamepad-2",
      "gift",
      "coffee",
      "shopping-bag",
      "brain",
    ],
  },
  {
    label: msg("Places", { $context: "icon category, project icon picker" }),
    icons: [
      "globe-2",
      "cloud",
      "smartphone",
      "monitor",
      "layers-3",
      "house",
      "map",
      "compass",
      "plane",
      "leaf",
      "sun",
      "moon",
    ],
  },
];

const ICON_KEYWORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  agent: ["bot", "sparkles", "brain"],
  ai: ["bot", "sparkles", "brain"],
  api: ["server", "braces", "workflow"],
  chat: ["message-square", "mail", "inbox"],
  data: ["database", "chart-line", "chart-pie"],
  deploy: ["rocket", "cloud", "package"],
  design: ["palette", "pen-tool", "image"],
  docs: ["book-open", "file-text", "notebook-pen"],
  done: ["circle-check", "trophy", "flag"],
  idea: ["lightbulb", "sparkles"],
  mobile: ["smartphone"],
  personal: ["heart", "house", "coffee"],
  pr: ["git-pull-request", "git-merge"],
  "pull request": ["git-pull-request", "git-merge"],
  release: ["rocket", "package", "flag"],
  review: ["eye", "git-pull-request", "message-square"],
  security: ["shield-check", "lock", "key"],
  settings: ["cog", "wrench"],
  task: ["list-todo", "clipboard-list", "circle-check"],
  test: ["flask-conical", "bug", "circle-check"],
  urgent: ["flame", "zap", "circle-alert"],
  wait: ["hourglass", "clock", "timer"],
  web: ["globe-2", "monitor"],
  work: ["briefcase", "kanban", "list-todo"],
};

export const MAX_ICON_RESULTS = 120;

export function filterProjectIconNames(query: string): ReadonlyArray<string> {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (tokens.length === 0) return PROJECT_ICON_CATEGORIES.flatMap((category) => category.icons);
  const phrase = tokens.join(" ");
  const exact = tokens.join("-");
  const keywordHits = Object.entries(ICON_KEYWORDS)
    .filter(([keyword]) => phrase.length > 1 && keyword.startsWith(phrase))
    .flatMap(([, names]) => names);
  const nameHits = lucideIconNames.filter((name) => tokens.every((token) => name.includes(token)));
  const rank = (name: string) => (name === exact ? 0 : name.startsWith(tokens[0] ?? "") ? 1 : 2);
  const ranked = nameHits.toSorted((a, b) => rank(a) - rank(b));
  const exactHits = ranked.filter((name) => name === exact);
  return [...new Set([...exactHits, ...keywordHits, ...ranked])].slice(0, MAX_ICON_RESULTS);
}

export const PROJECT_EMOJI_CATEGORIES: ReadonlyArray<{
  readonly label: string;
  readonly emojis: ReadonlyArray<{ readonly emoji: string; readonly label: string }>;
}> = [
  {
    label: msg("Work and tech", { $context: "emoji category, project icon picker" }),
    emojis: [
      { emoji: "💻", label: msg("Computer", { $context: "emoji name, project icon" }) },
      { emoji: "🖥️", label: msg("Desktop", { $context: "emoji name, project icon" }) },
      { emoji: "⌨️", label: msg("Keyboard", { $context: "emoji name, project icon" }) },
      { emoji: "📱", label: msg("Mobile", { $context: "emoji name, project icon" }) },
      { emoji: "🤖", label: msg("Robot", { $context: "emoji name, project icon" }) },
      { emoji: "🧠", label: msg("Brain", { $context: "emoji name, project icon" }) },
      { emoji: "⚙️", label: msg("Gear", { $context: "emoji name, project icon" }) },
      { emoji: "🛠️", label: msg("Tools", { $context: "emoji name, project icon" }) },
      { emoji: "🔧", label: msg("Wrench", { $context: "emoji name, project icon" }) },
      { emoji: "🧪", label: msg("Test tube", { $context: "emoji name, project icon" }) },
      { emoji: "🗄️", label: msg("Database", { $context: "emoji name, project icon" }) },
      { emoji: "☁️", label: msg("Cloud", { $context: "emoji name, project icon" }) },
      { emoji: "📦", label: msg("Package", { $context: "emoji name, project icon" }) },
      { emoji: "🔒", label: msg("Lock", { $context: "emoji name, project icon" }) },
      { emoji: "🔑", label: msg("Key", { $context: "emoji name, project icon" }) },
      { emoji: "🐛", label: msg("Bug", { $context: "emoji name, project icon" }) },
    ],
  },
  {
    label: msg("Status", { $context: "emoji category, project icon picker" }),
    emojis: [
      { emoji: "🚀", label: msg("Rocket", { $context: "emoji name, project icon" }) },
      { emoji: "✨", label: msg("Sparkles", { $context: "emoji name, project icon" }) },
      { emoji: "⚡", label: msg("Lightning", { $context: "emoji name, project icon" }) },
      { emoji: "🔥", label: msg("Fire", { $context: "emoji name, project icon" }) },
      { emoji: "💡", label: msg("Idea", { $context: "emoji name, project icon" }) },
      { emoji: "🎯", label: msg("Target", { $context: "emoji name, project icon" }) },
      { emoji: "✅", label: msg("Check", { $context: "emoji name, project icon" }) },
      { emoji: "⏳", label: msg("Hourglass", { $context: "emoji name, project icon" }) },
      { emoji: "📌", label: msg("Pin", { $context: "emoji name, project icon" }) },
      { emoji: "🚧", label: msg("Construction", { $context: "emoji name, project icon" }) },
      { emoji: "⭐", label: msg("Star", { $context: "emoji name, project icon" }) },
      { emoji: "🏁", label: msg("Finish flag", { $context: "emoji name, project icon" }) },
      { emoji: "📣", label: msg("Megaphone", { $context: "emoji name, project icon" }) },
      { emoji: "💬", label: msg("Speech bubble", { $context: "emoji name, project icon" }) },
      { emoji: "👀", label: msg("Eyes", { $context: "emoji name, project icon" }) },
      { emoji: "❤️", label: msg("Heart", { $context: "emoji name, project icon" }) },
    ],
  },
  {
    label: msg("Docs and data", { $context: "emoji category, project icon picker" }),
    emojis: [
      { emoji: "📚", label: msg("Books", { $context: "emoji name, project icon" }) },
      { emoji: "📝", label: msg("Memo", { $context: "emoji name, project icon" }) },
      { emoji: "📄", label: msg("Page", { $context: "emoji name, project icon" }) },
      { emoji: "📁", label: msg("Folder", { $context: "emoji name, project icon" }) },
      { emoji: "🗂️", label: msg("Dividers", { $context: "emoji name, project icon" }) },
      { emoji: "📊", label: msg("Bar chart", { $context: "emoji name, project icon" }) },
      { emoji: "📈", label: msg("Chart", { $context: "emoji name, project icon" }) },
      { emoji: "🗓️", label: msg("Calendar", { $context: "emoji name, project icon" }) },
      { emoji: "📎", label: msg("Paperclip", { $context: "emoji name, project icon" }) },
      { emoji: "🔖", label: msg("Bookmark", { $context: "emoji name, project icon" }) },
    ],
  },
  {
    label: msg("Fun and life", { $context: "emoji category, project icon picker" }),
    emojis: [
      { emoji: "🎮", label: msg("Game", { $context: "emoji name, project icon" }) },
      { emoji: "🎵", label: msg("Music", { $context: "emoji name, project icon" }) },
      { emoji: "🎬", label: msg("Movie", { $context: "emoji name, project icon" }) },
      { emoji: "🎨", label: msg("Palette", { $context: "emoji name, project icon" }) },
      { emoji: "📷", label: msg("Camera", { $context: "emoji name, project icon" }) },
      { emoji: "🛍️", label: msg("Shopping", { $context: "emoji name, project icon" }) },
      { emoji: "☕", label: msg("Coffee", { $context: "emoji name, project icon" }) },
      { emoji: "🍕", label: msg("Pizza", { $context: "emoji name, project icon" }) },
      { emoji: "🏠", label: msg("Home", { $context: "emoji name, project icon" }) },
      { emoji: "✈️", label: msg("Plane", { $context: "emoji name, project icon" }) },
      { emoji: "🌱", label: msg("Seedling", { $context: "emoji name, project icon" }) },
      { emoji: "🌍", label: msg("Globe", { $context: "emoji name, project icon" }) },
      { emoji: "🦄", label: msg("Unicorn", { $context: "emoji name, project icon" }) },
      { emoji: "🐙", label: msg("Octopus", { $context: "emoji name, project icon" }) },
      { emoji: "🐳", label: msg("Whale", { $context: "emoji name, project icon" }) },
      { emoji: "🦊", label: msg("Fox", { $context: "emoji name, project icon" }) },
    ],
  },
];

const MAX_EMOJI_LENGTH = 32;

// The server also rejects monograms longer than two graphemes (ProjectCommands.ts).
export function isValidProjectMonogram(text: string): boolean {
  if (!isProjectMonogramText(text)) return false;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  return Array.from(segments).length <= 2;
}

export function firstEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const segment = segments[Symbol.iterator]().next().value?.segment;
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(segment ?? "");
  const isKeycap = /^[#*0-9]️?⃣$/u.test(segment ?? "");
  if (
    !segment ||
    segment.length > MAX_EMOJI_LENGTH ||
    (!/\p{Extended_Pictographic}/u.test(segment) && !isFlag && !isKeycap)
  ) {
    return null;
  }
  return segment;
}

const DEFAULT_ICON = "folder-code";

export interface ProjectIconDraft {
  readonly mode: ProjectIconOverride["kind"];
  readonly iconName: string;
  readonly color: ProjectIconColor;
  readonly letters: string;
  readonly emoji: string;
}

export function initialProjectIconDraft(
  current: ProjectIconOverride | null,
  name: string,
): ProjectIconDraft {
  const automatic = deriveProjectIdentity(name);
  return {
    mode: current?.kind ?? "lucide",
    iconName: current?.kind === "lucide" ? current.name : DEFAULT_ICON,
    color: current && current.kind !== "emoji" ? current.color : automatic.color,
    letters: current?.kind === "monogram" ? current.text : automatic.monogram,
    emoji: current?.kind === "emoji" ? current.emoji : "💻",
  };
}

function normalizeMonogram(letters: string): string {
  return letters.normalize("NFKC").trim().toUpperCase();
}

/** Null when the monogram letters are not valid yet. */
export function projectIconFromDraft(draft: ProjectIconDraft): ProjectIconOverride | null {
  if (draft.mode === "lucide") return { kind: "lucide", name: draft.iconName, color: draft.color };
  if (draft.mode === "emoji") return { kind: "emoji", emoji: draft.emoji };
  const text = normalizeMonogram(draft.letters);
  return isValidProjectMonogram(text) ? { kind: "monogram", text, color: draft.color } : null;
}
