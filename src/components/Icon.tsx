import type { LucideIcon } from "lucide-react";

/**
 * The one drawing rule for chrome icons: 16px, stroke 1.5, currentColor.
 * Callers color the glyph through CSS (icon buttons use `var(--icon)`).
 * The only size exception is the 12px tree chevron (folder rows and
 * content-search groups); the ✦ mark is text, not an Icon.
 */
export type IconSize = 16 | 12;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

export function Icon({ icon: Glyph, size = 16, className, "aria-hidden": ariaHidden = true }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      color="currentColor"
      className={className}
      aria-hidden={ariaHidden}
      focusable="false"
    />
  );
}
