import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface EmptyStateProps {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  eyebrow = "DETAILS TO COME",
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Card className="empty-state" variant="outlined">
      <span aria-hidden="true" className="empty-state__icon">
        {icon}
      </span>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="empty-state__description">{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </Card>
  );
}
