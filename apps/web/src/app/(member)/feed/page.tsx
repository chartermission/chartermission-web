import type { Metadata } from "next";
import { FeedComposer } from "./feed-composer";
import { FeedControls } from "@/components/feed-controls";
import { FeedList } from "@/components/feed-list";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { feedPosts } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Home" };

/** Home feed — Figma "Web / Home feed" (node 8:84). */
export default function FeedPage() {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="sr-only">Home feed</h1>
      <FeedComposer />
      <FeedControls />
      <FeedList posts={feedPosts} />
    </PageColumns>
  );
}
