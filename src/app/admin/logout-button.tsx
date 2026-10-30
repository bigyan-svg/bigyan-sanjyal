"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setError("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        setError("Sign out could not be completed. Please try again.");
        return;
      }

      router.replace("/admin/login");
    } catch {
      setError("Sign out could not be completed. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="admin-dashboard__logout-wrap">
      <Button
        className="admin-dashboard__logout-button"
        disabled={isSigningOut}
        onClick={handleLogout}
        size="small"
        type="button"
        variant="secondary"
      >
        {isSigningOut ? (
          <LoaderCircle
            aria-hidden="true"
            className="admin-dashboard__logout-spinner"
            size={16}
          />
        ) : (
          <LogOut aria-hidden="true" size={16} />
        )}
        {isSigningOut ? "Signing out" : "Sign out"}
      </Button>
      {error ? (
        <p className="admin-dashboard__logout-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
