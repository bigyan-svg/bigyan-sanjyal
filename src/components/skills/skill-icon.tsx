import {
  Braces,
  Code2,
  Cpu,
  Database,
  Globe,
  Layers,
  Palette,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { isSkillIconName, type SkillIconName } from "@/lib/skill-icons";

const icons: Record<SkillIconName, LucideIcon> = {
  Braces,
  Code2,
  Cpu,
  Database,
  Globe,
  Layers,
  Palette,
  Terminal,
  Wrench,
};

export function SkillIcon({
  name,
  size = 18,
}: {
  name: string | null;
  size?: number;
}) {
  if (!name || !isSkillIconName(name)) {
    return null;
  }

  const Icon = icons[name];
  return <Icon aria-hidden="true" size={size} />;
}
