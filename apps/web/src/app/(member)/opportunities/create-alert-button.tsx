"use client";

import { useState } from "react";
import { Button, Icon } from "@chartermission/ui";

/** "Create alert" in the alerts panel. No backend yet: confirms locally. */
export function CreateAlertButton() {
  const [created, setCreated] = useState(false);
  return (
    <div aria-live="polite">
      {created ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-inverse">
          <Icon name="check" size={16} />
          Alert created — we’ll email you.
        </p>
      ) : (
        <Button variant="accent" size="small" onClick={() => setCreated(true)}>
          Create alert
        </Button>
      )}
    </div>
  );
}
