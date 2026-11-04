import { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { DocumentTabs } from "../../src/components/DocumentTabs";
import { CommentsToggle } from "../../src/components/CommentsToggle";
import { ReviewControls } from "../../src/components/ReviewControls";
import { appStrings } from "../../src/i18n/strings";
import type { EditorReviewState } from "../../src/editor/aiReview/types";
import "../../src/styles/app.css";

const noop = () => undefined;
const initialDocuments = Array.from({ length: 8 }, (_, index) => ({
  id: String(index), name: `Draft ${index + 1} with a long title`, relativePath: `notes/draft-${index + 1}.md`, suffix: "notes"
}));

function ChromeQA() {
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [documents, setDocuments] = useState(initialDocuments);
  const [activeId, setActiveId] = useState("0");
  const [reviewing, setReviewing] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const strings = appStrings[language];
  const review = {
    mode: "edit_file", file: { relativePath: "notes/draft-1.md" }, currentContent: "", activeHunkId: null,
    onAcceptHunk: noop, onRejectHunk: noop, onAcceptFile: noop, onRejectFile: noop,
    labels: { ...strings.editor.reviewToolbar, acceptChange: "Keep", rejectChange: "Restore" }
  } as EditorReviewState;
  Object.assign(window, { documentTabsUIQA: {
    language: setLanguage, review: setReviewing, collapsed: setCollapsed,
    activate: setActiveId,
    reset: () => { setDocuments(initialDocuments); setActiveId("0"); },
    snapshot: () => ({ activeId, ids: documents.map((document) => document.id) })
  } });
  const sidebarWidth = Math.min(560, window.innerWidth * 0.45, window.innerWidth - 320);
  return <div className={`app-shell${collapsed ? " sidebar-is-collapsed" : ""}`}
    style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <header className="app-topbar">
      <div className="topbar-sidebar-zone"><button type="button" className="icon-button">☰</button></div>
      <div className="topbar-editor-zone">
        <div className="topbar-document-navigation">
          <DocumentTabs documents={documents} activeId={activeId} labels={strings.topbar.tabs}
            onActivate={setActiveId} onClose={(id) => setDocuments((current) => current.filter((document) => document.id !== id))} />
        </div>
        <div className="topbar-slot">{reviewing ? <ReviewControls review={review} stale={false} hunkCount={23} onPrevious={noop} onNext={noop} /> : null}</div>
        <div className="topbar-actions">
          <span className="document-save-state">{strings.topbar.saveStatus.conflict}</span>
          <CommentsToggle count={12} unplaced={2} shown={false} fits={false} labels={strings.topbar.comments} onToggle={noop} />
        </div>
      </div>
    </header>
    <div className="app-content"><aside className="sidebar" /><main><p>Chrome fit and manual-activation keyboard fixture.</p></main></div>
  </div>;
}

createRoot(document.querySelector("#root")!).render(<ChromeQA />);
