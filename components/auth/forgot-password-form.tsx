"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { forgotPasswordAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await forgotPasswordAction({ email });
      if (!result.success) {
        setError(result.error ?? "Unable to send reset link.");
        return;
      }
      setMessage(
        result.data?.message ||
          "If an account exists for this email, we've sent password reset instructions.",
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="h-11"
        />
      </div>

      {message ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
      >
        {pending ? "Sending…" : "Send Reset Link"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Back to Login
        </Link>
      </p>
    </form>
  );
}
