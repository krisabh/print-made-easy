"use client";

import dynamic from "next/dynamic";

import { UploadFormSkeleton } from "@/components/upload-form-skeleton";
import type { ShopUploadContext } from "@/types";

const UploadForm = dynamic(
  () => import("@/components/upload-form").then((mod) => mod.UploadForm),
  {
    loading: () => <UploadFormSkeleton />,
    ssr: false,
  },
);

type UploadFormLoaderProps = {
  shop: ShopUploadContext;
};

export function UploadFormLoader({ shop }: UploadFormLoaderProps) {
  return <UploadForm shop={shop} />;
}
