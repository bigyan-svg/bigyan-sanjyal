"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AdminDataLoadError({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const retryStartedRef = useRef(false);

  useEffect(() => {
    if (!isPending) retryStartedRef.current = false;
  }, [isPending]);

  function retry() {
    if (retryStartedRef.current || isPending) return;
    retryStartedRef.current = true;
    startTransition(() => router.refresh());
  }

  return (
    <Card
      aria-busy={isPending}
      className="project-management__load-error"
      role="alert"
      variant="outlined"
    >
      <h2>{title}</h2>
      <p>{description}</p>
      <Button disabled={isPending} onClick={retry} type="button">
        {isPending ? "Retrying…" : "Try again"}
      </Button>
    </Card>
  );
}
