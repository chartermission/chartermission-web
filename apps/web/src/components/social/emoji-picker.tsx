"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Icon, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";

/** Emoji offered in the picker, by group. Kept to ones every current phone and desktop can draw. */
const GROUPS = [
  {
    id: "smileys",
    icon: "😀",
    emoji: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠",
  },
  {
    id: "gestures",
    icon: "👍",
    emoji: "👍 👎 👏 🙌 🤝 🙏 💪 ✊ 👊 🤞 ✌️ 🤟 👌 🤌 👋 🤚 ✋ 👆 👇 👉 👈 ☝️ ✍️ 🫶 🤲 👐 🫡 🤷 🙋 🙇 💃 🕺 👀 🧠 🗣️ 👤 👥 👨‍👩‍👧 🧑‍💻 🧑‍🏫 🧑‍🎓 🧑‍⚕️ 🧑‍🌾 🧑‍🔧 🧑‍🔬 🧑‍🎨 🧑‍💼 🧑‍🚀",
  },
  {
    id: "hearts",
    icon: "❤️",
    emoji: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✨ ⭐ 🌟 💫 🔥 ⚡ 💥 🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🏅 🎖️ 🎯 🚀 💡 📣 📢 🔔 ✅ ☑️ ✔️ ❌ ⚠️ ❓ ❗ ➕ ➡️ ⬆️ ⬇️ 🔝 🆕 🆓",
  },
  {
    id: "work",
    icon: "💼",
    emoji: "💼 📈 📉 📊 📋 📌 📍 📎 🖇️ 📝 ✏️ 📚 📖 🔖 🗂️ 📁 🗓️ 📅 ⏰ ⏳ 💻 🖥️ ⌨️ 📱 ☎️ 📧 ✉️ 📨 🔗 🔍 🔒 🔑 🛠️ ⚙️ 🧰 🧪 🔬 🔭 💊 🩺 🏗️ 🏭 🏦 🏛️ 🏫 🏥 🏢 💰 💵 💳 🪙 🤖 🛰️ 🎓 🎤 🎧 🎬 📷 🎨",
  },
  {
    id: "nature",
    icon: "🌍",
    emoji: "🌍 🌎 🌏 🌐 🗺️ 🌞 🌙 ⭐ ☁️ 🌧️ ⛈️ 🌈 🌊 🌋 🏔️ 🏜️ 🏝️ 🌴 🌳 🌲 🌵 🌾 🌱 🍃 🌻 🌺 🌸 🌹 🦁 🐘 🦒 🦓 🦏 🦛 🐆 🐅 🐊 🐒 🦍 🐪 🐫 🦅 🦜 🐢 🐍 🐝 🦋 🐟 🐬 🐳",
  },
  {
    id: "food",
    icon: "🍲",
    emoji: "🍲 🍛 🍚 🍜 🍝 🥘 🍗 🍖 🥩 🐟 🍤 🌽 🥕 🍅 🥑 🍠 🥜 🌶️ 🧅 🧄 🍞 🥖 🫓 🥞 🧀 🥚 🍳 🥗 🍕 🍔 🌯 🥙 🍌 🥭 🍍 🍊 🍋 🍉 🍇 🍓 🥥 🍰 🎂 🍪 🍫 🍯 ☕ 🍵 🥤 🧃 💧",
  },
  {
    id: "travel",
    icon: "✈️",
    emoji: "✈️ 🛫 🛬 🚗 🚕 🚌 🚎 🚆 🚇 🚲 🏍️ 🛵 🚚 🚢 ⛵ 🚁 🛣️ 🌉 🏠 🏡 🏘️ 🏕️ ⛺ 🏨 🕌 ⛪ 🛕 🏟️ ⚽ 🏀 🏐 🏃 🚴 🥁 🎶 🎵 🎸 🎺 🪘 🎭 🎮 🧩 ♟️",
  },
] as const;

/** Group names, in English; shown through t(). */
const GROUP_LABELS: Record<string, string> = {
  recent: "Recently used",
  smileys: "Smileys",
  gestures: "People and gestures",
  hearts: "Hearts and symbols",
  work: "Work and study",
  nature: "Nature and animals",
  food: "Food and drink",
  travel: "Travel and leisure",
};

const LISTS: Record<string, string[]> = Object.fromEntries(GROUPS.map((g) => [g.id, g.emoji.split(" ")]));
const RECENT_KEY = "cm_recent_emoji";
const RECENT_MAX = 16;

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function remember(emoji: string): string[] {
  const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private windows may refuse storage; the picker still works without a "recent" row.
  }
  return next;
}

/**
 * Put `emoji` where the caret is in `field` and give the new text to `onChange`. The caret ends up
 * after the emoji, so several can be added in a row.
 */
export function insertAtCaret(field: HTMLTextAreaElement | HTMLInputElement | null, value: string, emoji: string, onChange: (next: string) => void, max?: number) {
  const start = field?.selectionStart ?? value.length;
  const end = field?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + emoji + value.slice(end);
  if (max !== undefined && next.length > max) return;
  onChange(next);
  const caret = start + emoji.length;
  requestAnimationFrame(() => {
    field?.focus();
    field?.setSelectionRange(caret, caret);
  });
}

/**
 * A smiley button that opens a small panel of emoji in groups, with the member's recently used
 * ones first. Choosing one calls `onPick`; the panel stays open so several can be added, and
 * closes on Escape, on a click elsewhere, or when the button is pressed again.
 */
export function EmojiPicker({
  onPick,
  anchor,
  className,
  align = "end",
  placement = "below",
}: {
  onPick: (emoji: string) => void;
  anchor?: RefObject<HTMLElement | null>;
  className?: string;
  align?: "start" | "end";
  /** "above" for boxes at the foot of the page, where a panel below would be cut off. */
  placement?: "below" | "above";
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string>("smileys");
  const [recent, setRecent] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || anchor?.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor]);

  function toggle() {
    if (!open) {
      const stored = readRecent();
      setRecent(stored);
      setGroup(stored.length ? "recent" : "smileys");
    }
    setOpen(!open);
  }

  function pick(emoji: string) {
    setRecent(remember(emoji));
    onPick(emoji);
  }

  const tabs = [...(recent.length ? [{ id: "recent", icon: "🕘" }] : []), ...GROUPS.map((g) => ({ id: g.id as string, icon: g.icon as string }))];
  const shown = group === "recent" ? recent : (LISTS[group] ?? []);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-label={t("Add an emoji")}
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={toggle}
        className={cn("flex size-7 items-center justify-center rounded-full text-secondary transition-colors hover:bg-line hover:text-ink", open && "bg-line text-ink")}
      >
        <Icon name="smile" size={18} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label={t("Emoji")}
          className={cn(
            "absolute z-30 flex w-[304px] max-w-[calc(100vw-2rem)] flex-col rounded-card border border-line bg-card shadow-[0_12px_32px_rgb(15_42_42/0.18)]",
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          <div role="tablist" aria-label={t("Emoji groups")} className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={group === tab.id}
                aria-label={t(GROUP_LABELS[tab.id] ?? tab.id)}
                title={t(GROUP_LABELS[tab.id] ?? tab.id)}
                onClick={() => setGroup(tab.id)}
                className={cn("flex size-8 items-center justify-center rounded-md text-[17px] leading-none hover:bg-muted", group === tab.id && "bg-primary-tint")}
              >
                <span aria-hidden="true">{tab.icon}</span>
              </button>
            ))}
          </div>
          <div dir="ltr" className="grid max-h-[208px] grid-cols-8 gap-0.5 overflow-y-auto p-1.5">
            {shown.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => pick(emoji)}
                className="flex size-8 items-center justify-center rounded-md text-[20px] leading-none hover:bg-muted focus-visible:bg-muted"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
