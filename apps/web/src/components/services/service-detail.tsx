"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ServiceView } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { ShareOutButton } from "@/components/social/share-out";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { hostInputOf, hostName, serviceHref } from "./format";
import { ServiceCard } from "./service-card";
import { ServiceEditorDialog } from "./service-editor-dialog";

/** The service on its own page: the full card, Share, and Edit for the people who manage it. */
export function ServiceDetail({ service, signedIn }: { service: ServiceView; signedIn: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <ServiceCard service={service} signedIn={signedIn} linkTitle={false} clamp={false} headingLevel={1} bare />
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <ShareOutButton
          variant="secondary"
          size="small"
          request={{ path: serviceHref(service.id), title: service.title, text: t("{title}, offered by {name} on Charter Mission", { title: service.title, name: hostName(service.host) }) }}
        />
        {service.viewer.canManage && (
          <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
            Edit
          </Button>
        )}
      </div>
      {editing && (
        <ServiceEditorDialog
          host={hostInputOf(service.host)}
          service={service}
          onClose={() => setEditing(false)}
          onSaved={() => {
            toast.success("Service updated");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
