import React from "react";
import type { SectionId } from "./constants.js";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: SectionId;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-block" id={id}>
      <div className="settings-block__head">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
