import {
  activityMetadata,
  activityTitle,
  contextManifestProviderText,
  isGenericRunningStatus,
  receiptActivityTitle,
  turnReceiptDetailRows,
  turnReceiptSummary,
  visibleRunActivities
} from "../../assistant/assistantUtils";
import type { AssistantEntry } from "../../assistant/useAssistantRun";
import type { AppStrings } from "../../i18n/strings";
import type { AgentActivityRunEvent, AgentRunContextManifest } from "../../types/iliad";
import type { Ref } from "react";
import { ChevronRight } from "lucide-react";
import { AssistantMarkdown } from "./AssistantMarkdown";

interface AssistantTranscriptProps {
  entries: AssistantEntry[];
  labels: AppStrings["assistant"];
  runActivities?: AgentActivityRunEvent[];
  runningRunId: string | null;
  /** Live answer draft; the final entry text stays authoritative. */
  streamingText?: string;
  transcriptRef: Ref<HTMLDivElement>;
  onScroll?: () => void;
}

function StatusWave() {
  return (
    <span className="assistant-status-wave" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

// The permanent per-turn receipt: every assistant/error entry that carries a
// manifest or activities renders one, collapsed, unconditionally — what this
// turn used must never depend on what the previous turn looked like (ADR-0014).
function AssistantTurnReceipt({
  labels,
  manifest,
  activities
}: {
  labels: AppStrings["assistant"];
  manifest?: AgentRunContextManifest;
  activities?: AgentActivityRunEvent[];
}) {
  const receiptActivities = activities ?? [];
  const rows = turnReceiptDetailRows(manifest, receiptActivities.length > 0, labels.context);

  return (
    <details className="assistant-turn-receipt">
      <summary>
        <ChevronRight size={14} className="assistant-receipt-chevron" aria-hidden="true" />
        <span>{turnReceiptSummary(receiptActivities, labels)}</span>
      </summary>
      <div className="assistant-context-detail">
        {receiptActivities.length > 0 ? (
          <div className="assistant-activity-trail">
            {receiptActivities.map((activity) => {
              const metadata = activityMetadata(activity, labels.context);

              return (
                <div className="assistant-activity-row" data-status={activity.status} key={activity.activityId}>
                  <span className="assistant-activity-dot" aria-hidden="true" />
                  <span className="assistant-activity-main">
                    <span>{receiptActivityTitle(activity, labels.receipt)}</span>
                    {metadata ? <small>{metadata}</small> : null}
                  </span>
                  <small className="assistant-activity-status">{labels.activity[activity.status]}</small>
                </div>
              );
            })}
          </div>
        ) : null}
        {rows.map((row) => (
          <div className="assistant-context-row" key={row.id}>
            <span>{row.primary}</span>
            {row.secondary ? <small>{row.secondary}</small> : null}
          </div>
        ))}
        {manifest ? (
          <small className="assistant-context-provider">{contextManifestProviderText(manifest, labels.context)}</small>
        ) : null}
      </div>
    </details>
  );
}

function AssistantUserAttachments({
  attachments,
  label
}: {
  attachments: NonNullable<AssistantEntry["attachments"]>;
  label: string;
}) {
  return (
    <span className="assistant-user-attachment" aria-label={label}>
      {attachments.map((attachment, index) => (
        <span key={attachment.relativePath} title={attachment.relativePath}>
          {index > 0 ? " · " : ""}
          {attachment.label}
        </span>
      ))}
    </span>
  );
}

function AssistantActivityTrail({
  activities,
  labels
}: {
  activities: AgentActivityRunEvent[];
  labels: AppStrings["assistant"];
}) {
  const rows = visibleRunActivities(activities);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="assistant-activity-trail" aria-label={labels.activity.label}>
      {rows.map((activity) => {
        const metadata = activityMetadata(activity, labels.context);

        return (
          <div className="assistant-activity-row" data-status={activity.status} key={activity.activityId}>
            <span className="assistant-activity-dot" aria-hidden="true" />
            <span className="assistant-activity-main">
              <span>{activityTitle(activity, labels.activity)}</span>
              {metadata ? <small>{metadata}</small> : null}
            </span>
            <small className="assistant-activity-status">{labels.activity[activity.status]}</small>
          </div>
        );
      })}
    </div>
  );
}

export function AssistantTranscript({
  entries,
  labels,
  runActivities = [],
  runningRunId,
  streamingText = "",
  transcriptRef,
  onScroll
}: AssistantTranscriptProps) {
  let activeStatusRendered = false;
  // aria-live="off": the growing draft must not re-announce every flush; the
  // final assistant entry is the announcement.
  const streamingBlock =
    streamingText && runningRunId !== null ? (
      <div className="assistant-streaming" aria-live="off">
        <AssistantMarkdown text={streamingText} streaming />
      </div>
    ) : null;

  return (
    <div
      className={`assistant-transcript${runningRunId !== null ? " is-working" : ""}`}
      ref={transcriptRef}
      onScroll={onScroll}
    >
      {entries.map((entry) => {
        const isActiveStatus = entry.kind === "status" && runningRunId !== null && entry.id === `${runningRunId}-status`;
        activeStatusRendered = activeStatusRendered || isActiveStatus;
        const statusText = isActiveStatus && isGenericRunningStatus(entry.text, labels) ? "" : entry.text;
        const showTurnReceipt =
          (entry.kind === "assistant" || entry.kind === "error") &&
          Boolean(entry.contextManifest || (entry.activities && entry.activities.length > 0));

        return (
          <div
            key={entry.id}
            className={`assistant-entry is-${entry.kind}${isActiveStatus ? " is-active-status" : ""}`}
            aria-live={entry.kind === "status" ? "polite" : undefined}
            aria-label={isActiveStatus && !statusText ? labels.status.thinking : undefined}
          >
            {isActiveStatus ? (
              <>
                <span className="assistant-status-content">
                  <StatusWave />
                  {statusText ? <span className="assistant-status-text">{statusText}</span> : null}
                </span>
                <AssistantActivityTrail activities={runActivities} labels={labels} />
                {streamingBlock}
              </>
            ) : entry.kind === "assistant" ? (
              // Receipt leads the turn: the process happened before the answer.
              <>
                {showTurnReceipt ? (
                  <AssistantTurnReceipt labels={labels} manifest={entry.contextManifest} activities={entry.activities} />
                ) : null}
                <AssistantMarkdown text={entry.text} />
              </>
            ) : entry.kind === "error" ? (
              <>
                <span className="assistant-error-text">{entry.text}</span>
                {showTurnReceipt ? (
                  <AssistantTurnReceipt labels={labels} manifest={entry.contextManifest} activities={entry.activities} />
                ) : null}
              </>
            ) : entry.kind === "user" && (entry.selectionComments || entry.attachments?.length) ? (
              // Ephemeral in-session rendering: typed text, an optional compact
              // disclosure for the comment block, and attachment markers.
              // entry.text holds the full composed message, so restored threads
              // degrade gracefully.
              <>
                {entry.selectionComments ? (
                  <>
                    {entry.selectionComments.typedText ? (
                      <span className="assistant-user-typed-text">{entry.selectionComments.typedText}</span>
                    ) : null}
                    <details className="assistant-comments-disclosure">
                      <summary>{labels.selectionComments.disclosure(entry.selectionComments.count)}</summary>
                      <pre>{entry.selectionComments.block}</pre>
                    </details>
                  </>
                ) : (
                  <span className="assistant-user-typed-text">{entry.text}</span>
                )}
                {entry.attachments && entry.attachments.length > 0 ? (
                  <AssistantUserAttachments attachments={entry.attachments} label={labels.receipt.attachments} />
                ) : null}
              </>
            ) : (
              entry.text
            )}
          </div>
        );
      })}
      {runningRunId !== null && !activeStatusRendered ? (
        <div
          className="assistant-entry is-status is-active-status"
          aria-live="polite"
          aria-label={labels.status.thinking}
        >
          <span className="assistant-status-content">
            <StatusWave />
          </span>
          <AssistantActivityTrail activities={runActivities} labels={labels} />
          {streamingBlock}
        </div>
      ) : null}
    </div>
  );
}
