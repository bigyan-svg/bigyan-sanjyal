import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLoginPage() {
  return (
    <section aria-labelledby="admin-login-title" className="admin-login">
      <Container className="admin-login__container">
        <div className="admin-login__layout">
          <div className="admin-login__copy">
            <Link
              aria-label="Back to Bigyan Sanjyal's website"
              className="admin-login__brand"
              href="/"
            >
              <span aria-hidden="true" className="brand__mark">
                BS
              </span>
              <span className="brand__text">
                <span className="brand__name">Bigyan Sanjyal</span>
                <span className="brand__caption">Personal website</span>
              </span>
            </Link>

            <div className="admin-login__intro">
              <p className="eyebrow">
                <span aria-hidden="true" className="status-dot" />
                Secure administrator access
              </p>
              <h1 id="admin-login-title">
                Your workspace,
                <span className="text-gradient">ready when you are.</span>
              </h1>
              <p className="admin-login__description">
                Sign in to manage the content shared on this website.
              </p>
            </div>

            <div className="admin-login__assurance">
              <span aria-hidden="true" className="admin-login__assurance-icon">
                <ShieldCheck size={19} />
              </span>
              <p>
                <strong>Private workspace</strong>
                <span>For authorized administrators and editors.</span>
              </p>
            </div>
          </div>

          <Card
            aria-labelledby="admin-login-form-title"
            className="admin-login__panel"
            variant="glow"
          >
            <div className="admin-login__panel-heading">
              <span aria-hidden="true" className="admin-login__panel-icon">
                <LockKeyhole size={19} />
              </span>
              <div>
                <p className="eyebrow">Admin portal</p>
                <h2 id="admin-login-form-title">Welcome back</h2>
              </div>
            </div>
            <p className="admin-login__panel-description">
              Enter your account credentials to continue.
            </p>

            <AdminLoginForm />

            <div className="admin-login__panel-footer">
              <Link className="admin-login__back-link" href="/">
                <ArrowLeft aria-hidden="true" size={15} />
                Return to website
              </Link>
              <span>Sign-in details stay private</span>
            </div>
          </Card>
        </div>
      </Container>
    </section>
  );
}
