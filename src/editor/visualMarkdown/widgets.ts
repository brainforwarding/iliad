import katex from "katex";
import { WidgetType, type EditorView } from "@codemirror/view";

export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly fallbackAlt: string
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return this.src === other.src && this.alt === other.alt && this.fallbackAlt === other.fallbackAlt;
  }

  toDOM() {
    const figure = document.createElement("span");
    figure.className = "cm-image-block";

    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt || this.fallbackAlt;
    image.loading = "lazy";
    figure.appendChild(image);

    if (this.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.alt;
      figure.appendChild(caption);
    }

    return figure;
  }

  ignoreEvent() {
    return false;
  }
}

export class YouTubeVideoWidget extends WidgetType {
  constructor(
    private readonly embedSrc: string,
    private readonly title: string,
    private readonly fallbackTitle: string
  ) {
    super();
  }

  eq(other: YouTubeVideoWidget) {
    return this.embedSrc === other.embedSrc && this.title === other.title && this.fallbackTitle === other.fallbackTitle;
  }

  toDOM() {
    const figure = document.createElement("span");
    figure.className = "cm-youtube-video-block";

    const frame = document.createElement("iframe");
    frame.src = this.embedSrc;
    frame.title = this.title || this.fallbackTitle;
    frame.loading = "lazy";
    frame.allowFullscreen = true;
    // We rely on the youtube-nocookie embed domain plus this referrer policy to keep
    // playback working from the custom app origin. If YouTube ever starts blocking
    // embeds here (e.g. "Video unavailable" / referrer rejected), an alternative is to
    // stamp an explicit Referer at the Electron main level instead of in the renderer:
    // session.defaultSession.webRequest.onBeforeSendHeaders for the youtube(-nocookie)
    // /embed/* subframe requests, setting Referer to a stable app identity such as
    // "https://md.iliad.app/". (Prototyped on a dropped
    // youtube-embed-referrer branch, May 2026.)
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    figure.appendChild(frame);

    if (this.title) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.title;
      figure.appendChild(caption);
    }

    return figure;
  }

  ignoreEvent() {
    return false;
  }
}

export class HiddenSyntaxWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-hidden-syntax";

    return span;
  }
}

function renderKatexElement(className: string, tex: string, displayMode: boolean) {
  const span = document.createElement("span");
  span.className = className;

  try {
    katex.render(tex, span, {
      displayMode,
      throwOnError: true
    });
  } catch {
    span.classList.add("is-error");
    span.textContent = tex;
  }

  return span;
}

export class InlineMathWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super();
  }

  eq(other: InlineMathWidget) {
    return this.tex === other.tex;
  }

  toDOM() {
    return renderKatexElement("cm-md-inline-math", this.tex, false);
  }
}

export class DisplayMathWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super();
  }

  eq(other: DisplayMathWidget) {
    return this.tex === other.tex;
  }

  toDOM() {
    return renderKatexElement("cm-md-display-math", this.tex, true);
  }

  ignoreEvent() {
    return false;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
    private readonly labels: {
      markTaskIncomplete: string;
      markTaskComplete: string;
    }
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement("button");
    checkbox.type = "button";
    checkbox.className = this.checked ? "cm-task-checkbox is-checked" : "cm-task-checkbox";
    checkbox.setAttribute("aria-label", this.checked ? this.labels.markTaskIncomplete : this.labels.markTaskComplete);
    checkbox.textContent = this.checked ? "✓" : "";
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? "[ ]" : "[x]"
        }
      });
    });

    return checkbox;
  }

  ignoreEvent() {
    return false;
  }
}

export class LinkWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly href: string,
    private readonly onOpenLink: (href: string) => void | Promise<void>
  ) {
    super();
  }

  eq(other: LinkWidget) {
    return this.label === other.label && this.href === other.href;
  }

  toDOM() {
    const link = document.createElement("a");
    link.className = "cm-md-link";
    link.href = this.href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = this.href;
    link.textContent = this.label || this.href;
    link.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.onOpenLink(this.href);
    });

    return link;
  }

  ignoreEvent() {
    return false;
  }
}

export class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-list-bullet";
    bullet.textContent = "•";

    return bullet;
  }
}

export class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-md-horizontal-rule";

    return rule;
  }
}
