import { SkeletonCard } from "@/components/skeletons";

/** The composer's shape while the page loads. */
export function ComposerSkeleton() {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-5">
        <SkeletonCard lines={6} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={8} />
    </div>
  );
}
