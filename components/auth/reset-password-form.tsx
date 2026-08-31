"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { resetPasswordAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await resetPasswordAction({
        token,
        password,
        confirmPassword,
      });
      if (!result.success) {
        setError(result.error ?? "Unable to reset password.");
        return;
      }
      setMessage(
        result.data?.message || "Your password has been reset successfully.",
      );
      router.replace("/login?reset=success");
      router.refresh();
    });
  }

  if (message) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
        <p className="text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            Back to Login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
          className="h-11"
        />
        <p className="text-xs text-slate-500">At least 8 characters.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm Password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={8}
          required
          className="h-11"
        />
      </div>

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
        {pending ? "Updating…" : "Reset Password"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Back to Login
        </Link>
      </p>
    </form>
  );
}
