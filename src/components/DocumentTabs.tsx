import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface DocumentTabItem {
  id: string;
  name: string;
  relativePath: string;
  suffix?: string;
}

interface DocumentTabsProps {
  documents: readonly DocumentTabItem[];
  activeId: string | null;
  labels: {
    openDocuments: string;
    closeDocument: (name: string) => string;
    scrollLeft: string;
    scrollRight: string;
  };
  onActivate: (id: string) => void | Promise<void>;
  onClose: (id: string) => void | Promise<void>;
}

/** Manual activation: moving focus never opens a document. */
export function documentTabFocusIndex(index: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (index + 1 + count) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  return null;
}

/** Reveal within this scroll owner without scrolling the editor or window. */
export function documentTabRevealScrollLeft(scrollLeft: number, width: number, itemLeft: number, itemRight: number) {
  if (itemRight - itemLeft > width) return itemLeft;
  if (itemLeft < scrollLeft) return itemLeft;
  if (itemRight > scrollLeft + width) return itemRight - width;
  return scrollLeft;
}

export function DocumentTabs({ documents, activeId, labels, onActivate, onClose }: DocumentTabsProps) {
  const [focusedId, setFocusedId] = useState(activeId ?? documents[0]?.id ?? null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousIds = useRef(documents.map((document) => document.id));
  const focusWithin = useRef(false);
  const closingFocusedId = useRef<string | null>(null);
  const ids = documents.map((document) => document.id);
  const idsKey = JSON.stringify(ids);
  const rovingId = ids.includes(focusedId ?? "") ? focusedId : ids.includes(activeId ?? "") ? activeId : ids[0];
  const rovingIdRef = useRef(rovingId);
  rovingIdRef.current = rovingId;

  const measureOverflow = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const fits = strip.scrollWidth <= (strip.parentElement?.clientWidth ?? strip.clientWidth) + 1;
    const next = {
      left: !fits && strip.scrollLeft > 1,
      right: !fits && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
    };
    setOverflow((current) => current.left === next.left && current.right === next.right ? current : next);
  };

  const revealTab = (id: string | null) => {
    const strip = stripRef.current;
    const tab = id ? tabRefs.current.get(id) : null;
    const item = tab?.parentElement;
    if (!strip || !item) return;
    const stripRect = strip.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    strip.scrollLeft = documentTabRevealScrollLeft(
      strip.scrollLeft,
      strip.clientWidth,
      itemRect.left - stripRect.left + strip.scrollLeft,
      itemRect.right - stripRect.left + strip.scrollLeft
    );
    measureOverflow();
  };

  useEffect(() => {
    const closedFocusedId = closingFocusedId.current;
    if (!ids.includes(focusedId ?? "")) {
      const oldIndex = previousIds.current.indexOf(focusedId ?? "");
      const nextId = ids[Math.min(Math.max(oldIndex, 0), ids.length - 1)] ?? null;
      setFocusedId(nextId);
      const restoreCloseFocus = closedFocusedId === focusedId && document.activeElement === document.body;
      if ((focusWithin.current || restoreCloseFocus) && nextId) tabRefs.current.get(nextId)?.focus({ preventScroll: true });
    } else if (!focusWithin.current && activeId) {
      setFocusedId(activeId);
    }
    previousIds.current = ids;
    if (closedFocusedId && !ids.includes(closedFocusedId)) closingFocusedId.current = null;
    revealTab(activeId);
  }, [activeId, idsKey]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    measureOverflow();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      revealTab(focusWithin.current ? rovingIdRef.current ?? null : activeId);
      measureOverflow();
    });
    observer?.observe(strip);
    for (const child of strip.children) observer?.observe(child);
    return () => observer?.disconnect();
  }, [activeId, idsKey, documents.map((document) => `${document.name}/${document.suffix ?? ""}`).join("\n")]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const nextIndex = documentTabFocusIndex(index, documents.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextId = documents[nextIndex].id;
    setFocusedId(nextId);
    tabRefs.current.get(nextId)?.focus({ preventScroll: true });
    revealTab(nextId);
  };

  const scroll = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: direction * Math.max(80, strip.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className="document-tabs">
      {overflow.left || overflow.right ? (
        <button className="icon-button document-tabs__scroll" type="button" aria-label={labels.scrollLeft}
          disabled={!overflow.left} data-tooltip={labels.scrollLeft} onClick={() => scroll(-1)}>
          <Icon icon={ChevronLeft} />
        </button>
      ) : null}
      <div className="document-tabs__strip" ref={stripRef} role="tablist" aria-label={labels.openDocuments}
        onScroll={measureOverflow}
        onFocusCapture={() => { focusWithin.current = true; }}
        onBlurCapture={(event) => { focusWithin.current = event.currentTarget.contains(event.relatedTarget as Node | null); }}>
        {documents.map((document, index) => {
          const active = document.id === activeId;
          return (
            <div className={`document-tab${active ? " is-active" : ""}`} key={document.id} role="presentation">
              <button type="button" className="document-tab__activate" role="tab" aria-selected={active}
                aria-label={`${document.name} (${document.relativePath})`} data-tooltip={document.relativePath}
                tabIndex={document.id === rovingId ? 0 : -1}
                ref={(element) => { if (element) tabRefs.current.set(document.id, element); else tabRefs.current.delete(document.id); }}
                onFocus={() => setFocusedId(document.id)} onKeyDown={(event) => onTabKeyDown(event, index)}
                onClick={() => { void onActivate(document.id); }}>
                <span className="document-tab__name">{document.name}</span>
                {document.suffix ? <span className="document-tab__suffix">{document.suffix}</span> : null}
              </button>
              <button type="button" className="document-tab__close" aria-label={labels.closeDocument(document.relativePath)}
                data-tooltip={labels.closeDocument(document.relativePath)} tabIndex={document.id === rovingId ? 0 : -1}
                onFocus={() => setFocusedId(document.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.currentTarget === window.document.activeElement) closingFocusedId.current = document.id;
                  void onClose(document.id);
                }}>
                <Icon icon={X} size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {overflow.left || overflow.right ? (
        <button className="icon-button document-tabs__scroll" type="button" aria-label={labels.scrollRight}
          disabled={!overflow.right} data-tooltip={labels.scrollRight} onClick={() => scroll(1)}>
          <Icon icon={ChevronRight} />
        </button>
      ) : null}
    </div>
  );
}
