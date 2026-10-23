"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main className="page">
        <p className="error">
          NEXT_PUBLIC_CONVEX_URL is not set. Run <code>npx convex dev</code> locally, or set the Vercel
          build command to <code>npx convex deploy --cmd &apos;npm run build&apos;</code>.
        </p>
      </main>
    );
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
