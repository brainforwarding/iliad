import { Component, type ErrorInfo, type ReactNode } from "react";
import { ClipMark } from "./ClipMark";

interface EditorErrorBoundaryProps {
  children: ReactNode;
  labels: {
    crashTitle: string;
  };
  resetKey: string;
}

interface EditorErrorBoundaryState {
  error: Error | null;
  resetKey: string;
}

export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  state: EditorErrorBoundaryState = {
    error: null,
    resetKey: this.props.resetKey
  };

  static getDerivedStateFromError(error: Error): Partial<EditorErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: EditorErrorBoundaryProps,
    state: EditorErrorBoundaryState
  ): Partial<EditorErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return {
        error: null,
        resetKey: props.resetKey
      };
    }

    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Editor crashed.", error);
    void window.iliad.diagnostics?.log({
      level: "error",
      area: "app",
      event: "renderer.editor_crashed",
      details: {
        errorName: error.name,
        errorMessage: error.message,
        editorResetId: this.props.resetKey,
        componentStack: errorInfo.componentStack ?? null
      }
    });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="editor-shell">
          <div className="editor-empty">
            <ClipMark asleep size={72} className="editor-empty__mark" />
            <h1>{this.props.labels.crashTitle}</h1>
            <p>{this.state.error.message}</p>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
