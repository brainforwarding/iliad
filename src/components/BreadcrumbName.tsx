import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TypedName } from "./TypedName";

interface BreadcrumbNameProps {
  /** The document name without its Markdown extension. */
  name: string;
  /** Set while the name should type itself (a fresh auto-name); changes restart it. */
  typingKey?: number | null;
  /** Double-click renames only a real, reviewable-free document. */
  canRename: boolean;
  renaming: boolean;
  renameLabel: string;
  onStartRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
}

/**
 * The breadcrumb's last part: the document name. Double-click opens a small
 * inline field in place (Enter saves, Esc cancels, leaving it saves) that
 * commits through the same rename path as the file tree.
 */
export function BreadcrumbName({
  name,
  typingKey,
  canRename,
  renaming,
  renameLabel,
  onStartRename,
  onCommitRename,
  onCancelRename
}: BreadcrumbNameProps) {
  if (renaming && canRename) {
    return (
      <BreadcrumbRenameInput name={name} label={renameLabel} onCommit={onCommitRename} onCancel={onCancelRename} />
    );
  }

  return (
    <span
      className="topbar-breadcrumb-current"
      aria-current="page"
      onDoubleClick={
        canRename
          ? (event) => {
              event.preventDefault();
              onStartRename();
            }
          : undefined
      }
    >
      {typingKey ? <TypedName key={typingKey} text={name} /> : name}
    </span>
  );
}

function BreadcrumbRenameInput({
  name,
  label,
  onCommit,
  onCancel
}: {
  name: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (finished.current) {
      return;
    }

    finished.current = true;

    if (commit && value.trim() && value.trim() !== name) {
      onCommit(value);
    } else {
      onCancel();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  return (
    <span className="topbar-breadcrumb-current topbar-breadcrumb-rename" aria-current="page">
      <input
        ref={inputRef}
        className="topbar-breadcrumb-input"
        aria-label={label}
        value={value}
        spellCheck={false}
        onBlur={() => finish(true)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </span>
  );
}
