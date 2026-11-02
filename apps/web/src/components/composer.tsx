"use client";

import { Avatar, Button, Icon, Panel, type IconName } from "@chartermission/ui";
import { viewer } from "@/lib/mock-data";

const tools: { icon: IconName; label: string; color: string }[] = [
  { icon: "image", label: "Photo", color: "text-info" },
  { icon: "link", label: "Link", color: "text-success" },
  { icon: "chart", label: "Poll", color: "text-accent" },
  { icon: "hash", label: "Topic", color: "text-primary-light" },
];

/** "Share an update" box at the top of the feed. Opens the composer dialog. */
export function Composer({ onOpen }: { onOpen?: (tool?: string) => void }) {
  return (
    <Panel className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={viewer.name} tone="primary" />
        <button
          type="button"
          onClick={() => onOpen?.()}
          className="flex h-11 flex-1 items-center rounded-[22px] bg-muted px-4 text-left text-sm text-disabled hover:bg-primary-tint-2"
        >
          Share an update, ask a question or start a poll…
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              onClick={() => onOpen?.(tool.label.toLowerCase())}
              className="flex items-center gap-1.5 rounded-md text-sm font-medium text-body hover:text-ink"
            >
              <Icon name={tool.icon} size={18} className={tool.color} />
              {tool.label}
            </button>
          ))}
        </div>
        <Button size="small" onClick={() => onOpen?.()}>
          Post
        </Button>
      </div>
    </Panel>
  );
}
