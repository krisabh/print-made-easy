"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loginAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginFormProps = {
  nextPath?: string | null;
};

function safeNextPath(raw: string | null | undefined) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginAction({ email, password });
      if (!result.success) {
        setError(result.error ?? "Invalid email or password");
        return;
      }
      const destination =
        safeNextPath(nextPath) || result.data?.redirectTo || "/dashboard";
      router.replace(destination);
      router.refresh();
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
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
      >
        {pending ? "Signing in…" : "Login"}
      </Button>
      <p className="text-center text-sm text-slate-500">
        New shopkeeper?{" "}
        <Link href="/signup" className="font-medium text-blue-600 hover:underline">
          Create your shop
        </Link>
      </p>
    </form>
  );
}
