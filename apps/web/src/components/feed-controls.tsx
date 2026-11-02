"use client";

import { useState } from "react";
import { FilterSelect, SegmentedControl } from "@chartermission/ui";

const views = [
  { value: "for-you", label: "For You" },
  { value: "following", label: "Following" },
  { value: "latest", label: "Latest" },
] as const;

const countries = [
  { value: "", label: "All countries" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "NG", label: "Nigeria" },
  { value: "ZA", label: "South Africa" },
];

const sectors = [
  { value: "", label: "All sectors" },
  { value: "agriculture", label: "Agriculture" },
  { value: "climate", label: "Climate" },
  { value: "finance", label: "Finance" },
  { value: "technology", label: "Technology" },
];

export function FeedControls() {
  const [view, setView] = useState<(typeof views)[number]["value"]>("for-you");
  return (
    <div className="flex items-center justify-between">
      <SegmentedControl label="Feed view" items={views} value={view} onChange={setView} />
      <div className="flex items-center gap-2">
        <FilterSelect label="Country" options={countries} defaultValue="" />
        <FilterSelect label="Sector" options={sectors} defaultValue="" />
      </div>
    </div>
  );
}
