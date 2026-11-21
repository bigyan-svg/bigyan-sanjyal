"use client";

import { useEffect, useRef } from "react";
import { acquireDocumentScrollLockForEffect } from "@/lib/document-scroll-lock";

export function useDocumentScrollLock(active: boolean): void {
  const ownerRef = useRef(Symbol("document-scroll-lock"));

  useEffect(
    () => acquireDocumentScrollLockForEffect(active, ownerRef.current),
    [active],
  );
}
