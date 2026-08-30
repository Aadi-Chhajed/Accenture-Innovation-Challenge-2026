"use client";

import dynamic from "next/dynamic";

const TriageApp = dynamic(
  () => import("@/components/TriageApp").then((mod) => mod.TriageApp),
  { ssr: false }
);

export default function Home() {
  return <TriageApp />;
}
