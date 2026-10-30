export const SKILL_ICON_OPTIONS = [
  { value: "Braces", label: "Braces" },
  { value: "Code2", label: "Code" },
  { value: "Cpu", label: "Processor" },
  { value: "Database", label: "Database" },
  { value: "Globe", label: "Globe" },
  { value: "Layers", label: "Layers" },
  { value: "Palette", label: "Palette" },
  { value: "Terminal", label: "Terminal" },
  { value: "Wrench", label: "Wrench" },
] as const;

export type SkillIconName = (typeof SKILL_ICON_OPTIONS)[number]["value"];

const skillIconNames = new Set<string>(SKILL_ICON_OPTIONS.map(({ value }) => value));

export function isSkillIconName(value: string): value is SkillIconName {
  return skillIconNames.has(value);
}
