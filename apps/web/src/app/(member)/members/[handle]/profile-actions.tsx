"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@chartermission/ui";

/** Small "Connect" button for member lists; shows "Pending" once a request is sent. */
export function ConnectButton({ name }: { name: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button variant="secondary" size="small" aria-pressed={pending} onClick={() => setPending((value) => !value)}>
      {pending ? "Pending" : "Connect"}
      <span className="sr-only"> with {name}</span>
    </Button>
  );
}

/** Connect / Follow / more actions in the profile header. Local state until the API exists. */
export function ProfileActions({ name, isViewer }: { name: string; isViewer: boolean }) {
  const [pending, setPending] = useState(false);
  const [following, setFollowing] = useState(false);

  if (isViewer) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/settings/profile" className={buttonClasses()}>
          Edit profile
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button aria-pressed={pending} onClick={() => setPending((value) => !value)}>
        {pending ? "Request sent" : "Connect"}
      </Button>
      <Button variant="secondary" aria-pressed={following} onClick={() => setFollowing((value) => !value)}>
        {following ? "Following" : "Follow"}
      </Button>
      <Button variant="ghost" aria-label={`More actions for ${name}`}>
        <span aria-hidden="true">···</span>
      </Button>
    </div>
  );
}
