"use client";

import { useRef, useState } from "react";
import {
  BriefcaseBusiness,
  FileText,
  FolderKanban,
  GraduationCap,
  Mail,
  RotateCw,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestAdminDashboardStatistic } from "@/lib/admin-dashboard-statistics-client";
import {
  mergeAdminDashboardStatistics,
  type AdminDashboardStatisticKey,
  type AdminDashboardStatistics,
} from "@/lib/admin-dashboard-statistics-types";
import { Card } from "@/components/ui/card";

const statisticCards: {
  title: string;
  icon: LucideIcon;
  total: AdminDashboardStatisticKey;
  secondary: AdminDashboardStatisticKey;
  secondaryLabel: "Published" | "New";
  singular: string;
  plural: string;
}[] = [
  { title: "Projects", icon: FolderKanban, total: "projectsTotal", secondary: "projectsPublished", secondaryLabel: "Published", singular: "project", plural: "projects" },
  { title: "Blog posts", icon: FileText, total: "postsTotal", secondary: "postsPublished", secondaryLabel: "Published", singular: "blog post", plural: "blog posts" },
  { title: "Skills", icon: Wrench, total: "skillsTotal", secondary: "skillsPublished", secondaryLabel: "Published", singular: "skill", plural: "skills" },
  { title: "Education", icon: GraduationCap, total: "educationTotal", secondary: "educationPublished", secondaryLabel: "Published", singular: "education record", plural: "education records" },
  { title: "Work experience", icon: BriefcaseBusiness, total: "experienceTotal", secondary: "experiencePublished", secondaryLabel: "Published", singular: "experience record", plural: "experience records" },
  { title: "Contact messages", icon: Mail, total: "messagesTotal", secondary: "messagesNew", secondaryLabel: "New", singular: "message", plural: "messages" },
];

export function DashboardStatistics({
  initialStatistics,
}: {
  initialStatistics: AdminDashboardStatistics;
}) {
  const [statistics, setStatistics] = useState(initialStatistics);
  const [pendingKeys, setPendingKeys] = useState<Set<AdminDashboardStatisticKey>>(
    () => new Set(),
  );
  const pendingKeysRef = useRef(new Set<AdminDashboardStatisticKey>());
  const [announcement, setAnnouncement] = useState("");

  async function retryStatistic(key: AdminDashboardStatisticKey) {
    if (pendingKeysRef.current.has(key)) return;
    pendingKeysRef.current.add(key);
    setPendingKeys((current) => new Set(current).add(key));
    setAnnouncement("");

    try {
      const statistic = await requestAdminDashboardStatistic(key);

      setStatistics((current) =>
        mergeAdminDashboardStatistics(current, { [key]: statistic }),
      );
      setAnnouncement(
        statistic.status === "available"
          ? `${getStatisticLabel(key)} count refreshed.`
          : `${getStatisticLabel(key)} count is still unavailable. You can retry.`,
      );
    } catch {
      setAnnouncement(
        `Could not refresh the ${getStatisticLabel(key).toLowerCase()} count. Please try again.`,
      );
    } finally {
      pendingKeysRef.current.delete(key);
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <>
      <div className="admin-dashboard__stat-grid">
        {statisticCards.map((card) => {
          const Icon = card.icon;
          const total = statistics[card.total] ?? { status: "unavailable" as const };
          const secondary = statistics[card.secondary] ?? { status: "unavailable" as const };

          return (
            <Card className="admin-dashboard__stat-card" key={card.title} variant="outlined">
              <div className="admin-dashboard__stat-heading">
                <h3>{card.title}</h3>
                <span aria-hidden="true" className="admin-dashboard__stat-icon">
                  <Icon size={17} />
                </span>
              </div>
              <div className="admin-dashboard__stat-values">
                <div>
                  <dl className="admin-dashboard__stat-total">
                    <dt>Total records</dt>
                    <dd>
                      {total.status === "available"
                        ? total.count.toLocaleString()
                        : "Unavailable"}
                    </dd>
                  </dl>
                  <div className="admin-dashboard__stat-support">
                    {total.status === "unavailable" ? (
                      <RetryButton
                        isPending={pendingKeys.has(card.total)}
                        label={`${getStatisticLabel(card.total)} count`}
                        onRetry={() => void retryStatistic(card.total)}
                      />
                    ) : (
                      <p>
                        {total.count === 0
                          ? `No ${card.plural} yet.`
                          : `${total.count.toLocaleString()} ${total.count === 1 ? card.singular : card.plural} stored.`}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <dl className="admin-dashboard__stat-secondary">
                    <dt>{card.secondaryLabel}</dt>
                    <dd>
                      {secondary.status === "available"
                        ? secondary.count.toLocaleString()
                        : "Unavailable"}
                    </dd>
                  </dl>
                  <div className="admin-dashboard__stat-support">
                    {secondary.status === "unavailable" ? (
                      <RetryButton
                        isPending={pendingKeys.has(card.secondary)}
                        label={`${getStatisticLabel(card.secondary)} count`}
                        onRetry={() => void retryStatistic(card.secondary)}
                      />
                    ) : (
                      <p>
                        {card.secondaryLabel === "New" && secondary.count === 0
                          ? "No new messages."
                          : card.secondaryLabel === "Published" && secondary.count === 0
                            ? "No published records."
                            : card.secondaryLabel === "New"
                              ? "Awaiting review."
                              : "Available on the public site."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p aria-live="polite" className="admin-dashboard__statistics-announcement" role="status">
        {announcement}
      </p>
    </>
  );
}

function RetryButton({
  isPending,
  label,
  onRetry,
}: {
  isPending: boolean;
  label: string;
  onRetry: () => void;
}) {
  return (
    <Button
      aria-label={`Retry ${label}`}
      className="admin-dashboard__stat-retry"
      disabled={isPending}
      onClick={onRetry}
      size="small"
      variant="subtle"
    >
      <RotateCw aria-hidden="true" size={14} />
      {isPending ? "Retrying" : "Retry"}
    </Button>
  );
}

function getStatisticLabel(key: AdminDashboardStatisticKey): string {
  const card = statisticCards.find((item) => item.total === key || item.secondary === key);
  if (!card) return "Dashboard";
  return card.total === key
    ? `${card.title} total`
    : `${card.secondaryLabel} ${card.title.toLowerCase()}`;
}
