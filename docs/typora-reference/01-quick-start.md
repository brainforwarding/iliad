# Typora Feature Reference — Quick Start

> Own-words summaries of Typora's Quick Start documentation, for use as inspiration for Iliad. Source URLs are linked at each section.

> **Verdict legend.** Sections below may be tagged with a verdict from [`../source-as-contract.md`](../source-as-contract.md): **REJECTED** = breaks the rule that the on-disk `.md` is ground truth; **BORDERLINE** = acceptable if used deliberately, document the dialect choice. Unflagged sections are safe under the rule.

## Quick Start

Source: https://support.typora.io/Quick-Start/

Typora positions itself as a hybrid between an editor and a viewer. The headline behavior is **live preview without a split pane**: as soon as you finish typing inline syntax, it renders in place, and block-level syntax flips to rendered form as you keep editing. The Markdown markers are hidden once the construct is recognized, leaving you with a clean WYSIWYG-feeling document while the underlying file stays plain Markdown (GitHub Flavored).

Copy/paste is unusually opinionated. By default **Copy** produces HTML so that other apps receive styled text, but a preference toggles the default to Markdown source. There are explicit shortcuts for each direction: **Shift+Cmd/Ctrl+C** copies the Markdown source, and **Shift+Cmd/Ctrl+V** pastes as plain text. Smart paste inspects the clipboard and converts HTML it finds into native Markdown structures.

The **Files Sidebar** has three modes — an Outline (table of contents), a File Tree (folder hierarchy), and a File List — and is toggled from the menubar on macOS or the status bar on Windows/Linux. **Quick Open** (Cmd+Shift+O on macOS, Ctrl+P on Windows/Linux) is the fast file switcher; **Global Search** (Cmd/Ctrl+Shift+F) scans across the open folder. A separate Outline can be pinned to the left, and the word count widget on the toolbar reveals selection statistics on click with an option to keep it pinned.

Export targets cover **PDF, HTML, unstyled HTML, image**, plus any format Pandoc can produce. Help menu items link directly to a Markdown reference and a Custom Themes guide, doubling as a built-in onboarding path.

---

## Markdown Reference

Source: https://support.typora.io/Markdown-Reference/

This article is the authoritative catalogue of Markdown that Typora understands. It covers the full block syntax — paragraphs separated by blank lines, **Shift+Return** for a hard line break, headings via `#` through `######` with **Cmd/Ctrl+1..6** shortcuts, blockquotes that auto-extend their `>` prefix as you write, ordered/unordered lists, and **task lists** with clickable checkboxes (`[ ]` / `[x]`). Code fences require triple backticks plus an optional language tag, and math blocks are entered by typing `$$` and pressing Return.

Tables are first-class: typing a single pipe-delimited header row and pressing Return spawns a full table editor. Each cell supports inline Markdown, alignment is set with colons in the separator row (`:---`, `:---:`, `---:`), and a floating toolbar appears on focus with controls for resize, alignment, row/column add/delete. Other block constructs include footnotes (`[^id]` with hover preview), horizontal rules (`---` or `***`), YAML front matter (`---` at top of file), `[toc]` for an auto-updating table of contents, and GitHub-style callouts (which require a preference to enable).

Inline syntax includes the standard `[text](url)` links, reference links (`[text][id]` with a definition block), internal anchor links to headings (`[text](#header-name)` — Cmd/Ctrl+click to jump), autolinks via `<...>`, emphasis and strong (`*` / `**` / `_` / `__`), inline code (backticks), strikethrough (`~~text~~`), images (`![alt](src "title")`), and emoji shortcodes (`:name:`) with autocomplete after typing `:`. Several extras are opt-in via preferences: inline math (`$...$`), subscript (`H~2~O`), superscript (`X^2^`), and highlight (`==text==`).

For HTML, Typora renders inline tags like `<u>`, `<span style="...">`, and embedded `<video>`/`<iframe>` directly. Backslash escapes apply to Markdown punctuation (`\*literal\*`). YAML keys such as `typora-root-url` control how relative image paths are previewed.

![Drag and drop image insertion](./assets/quick-start/markdown-reference/drag-img.gif)
_Animated demo of dragging an image file into the editor and seeing it inlined._

---

## About Themes

Source: https://support.typora.io/About-Themes/

Themes in Typora are pure CSS files dropped into a theme folder. Six themes ship by default and are switchable from a dedicated **Themes** menu. Because the rendering surface is the editor itself, the same CSS controls both editing and previewing — there is no separate preview stylesheet to maintain.

Light and dark are configured **independently**, and Typora can follow the OS color scheme automatically by reading `prefers-color-scheme` media queries inside theme CSS. The preferences panel exposes an **Open Theme Folder** button to jump to the directory; a curated **Theme Gallery** at theme.typora.io lets the community share custom themes.

Naming rules are strict: theme filenames must be lowercase, hyphen-separated (no spaces or special characters), and Typora converts them to a human-readable label in the menu (e.g., `my-first-typora-theme.css` becomes "My First Typora Theme"). Authors debug themes with **View → Toggle DevTools** (or Safari DevTools on macOS), since the editor is essentially a styled web view.

![Light/dark theme selection](./assets/quick-start/about-themes/light-dark-mode.png)
_Preferences UI showing separate theme selectors for light and dark mode._

![Theme Gallery](./assets/quick-start/about-themes/theme-gallery.png)
_Community theme gallery on theme.typora.io._

![Preferences on macOS](./assets/quick-start/about-themes/pref-mac.png)
_macOS preferences panel exposing the theme folder._

![Preferences on Windows/Linux](./assets/quick-start/about-themes/pref-electron.png)
_Electron-based preferences panel on Windows/Linux._

---

## Typora on Linux

Source: https://support.typora.io/Typora-on-Linux/

Covers platform installation steps. On Debian/Ubuntu the recommended path is to add Typora's GPG key to `/etc/apt/keyrings/typora.gpg` and configure the apt repo with secure signing, then `sudo apt-get install typora`. There are equivalent flows for Linux Mint, manual `.deb` install, snap (`snap install typora`), ChromeOS (after enabling the Linux container), and a generic `Typora-linux-x64.tar.gz` for other distros. Wayland users can pass `--enable-features=UseOzonePlatform --ozone-platform=wayland`; `--disable-gpu` helps with rendering glitches; `GTK_USE_PORTAL=0` works around portal-related dialog bugs. Troubleshooting tips include `ldd typora | grep not` for missing deps and `chmod 4755 /usr/share/typora/chrome-sandbox` for sandbox permissions. One platform-specific shortcut quirk: **Ctrl+5** (Heading 5) collides with fcitx.

![Typora on Linux](./assets/quick-start/typora-on-linux/screenshot.png)
_Application interface running on Linux._

![Dialog rendering issue](./assets/quick-start/typora-on-linux/dialog-issue.png)
_Example of a text display problem when GTK portals misbehave._

---

## Table Editing

Source: https://support.typora.io/Table-Editing/

Typora aims to make the table the most "app-like" element of the editor. You create one either by writing a GFM header row plus Return or by inserting from the menu bar. A **floating tooltip** appears whenever the cursor is in a table, hosting controls for resize, alignment per column (default/left/center/right), and delete. Right-clicking a cell opens a context menu for row/column operations.

Row navigation is keyboard-friendly. **Tab** moves between cells and, in newer versions, automatically appends a new row when you Tab past the last cell. **Cmd/Ctrl+Enter** inserts an empty row below the current one. **Shift+Alt+Cmd/Ctrl+L** is the "delete line" shortcut that doubles as delete-row in tables. Columns are added or removed from the right-click menu.

For tables larger than 6×10, the resize widget lets you type custom dimensions directly. Reordering rows or columns is a **drag-and-drop gesture on the left/top border** — a small interaction detail that matters for usability. Alignment is persisted as `style="text-align:..."` on the `<td>` elements (so it round-trips through HTML export). On a MacBook with a Touch Bar, the bar surfaces table-aware controls (insert row, alignment) when the cursor is inside a table.

![Table menu](./assets/quick-start/table-editing/table-menu.png)
_Table-related menu items in the Paragraph menu._

![Row addition](./assets/quick-start/table-editing/row-addition.gif)
_Pressing Tab in the last cell auto-creates a new row._

![Resize tooltip](./assets/quick-start/table-editing/resize-tooltip.png)
_Floating tooltip lets you set custom table dimensions._

![Alignment icons](./assets/quick-start/table-editing/alignment.png)
_Alignment controls in the table toolbar._

![Touch Bar table controls](./assets/quick-start/table-editing/touchbar.png)
_Touch Bar surfaces table editing actions on MacBook._

---

## Links

Source: https://support.typora.io/Links/

The Links article enumerates every way to point at something else. Standard inline links use `[label](target "title")`, reference links pair `[label][ref]` with a `[ref]: url` definition block, and autolinks wrap a URL in angle brackets. Typora also auto-detects bare URLs as you type.

The interesting features are the navigation conveniences. **Cmd-click (macOS) or Ctrl-click (Linux/Windows)** activates a link — opens it in the browser, jumps to an anchor, or opens another Markdown file inside Typora. Local file links accept absolute or relative paths (with platform-aware Unix/Windows separator handling), and the **`.md` extension can be omitted**. You can deep-link into a section of another document with `[text](Readme1.md#header-1)`.

Internal anchors are derived from heading text using GitHub-style slug rules; duplicate headings get numbered suffixes (`-1`, `-2`). You can also drop a named HTML anchor (`<a id="..."></a>`) where Typora wouldn't otherwise generate one. If a relative target file doesn't exist, hovering reveals a tooltip that nudges you to fix the path or create the file. Typora warns when a URL omits a protocol because that ambiguity can break interpretation.

---

## HTML

> **BORDERLINE under [source-as-contract](../source-as-contract.md).** Embedded HTML inside Markdown is valid but degrades portability — GitHub previews, Pandoc, and static-site renderers each handle inline HTML differently. Use it only when no Markdown form expresses the intent, and never as a substitute for layout-level structure.

Source: https://support.typora.io/HTML/

Typora renders raw HTML inline alongside Markdown. Closing an inline tag immediately renders it in place (`<span style="color:red">red</span>`, `<sup>`, `<kbd>`, `<ruby>`), and HTML entities (`&reg;`, `&#182;`) become their Unicode glyphs. **Block-level HTML** can be edited either as live output or as raw source — clicking into the block (or Cmd/Ctrl-clicking) toggles between source view and rendered view. Tags that have no visible output (`<script>`, `<meta>`, `<style>`) stay in source form so they aren't accidentally hidden.

For media, **drag-and-drop on a video** writes a `<video src="...">` tag. `<audio>` works the same way, and `<iframe>` embeds are supported inside a sandbox (no script execution, no access to the document or local files). HTML comments (`<!-- ... -->`) survive in the source but are stripped from print/export. `<details>`/`<summary>` give you native collapsible sections.

There are deliberate security constraints. Scripts, `onload` handlers, and `class`/`id`/`data-*` attributes are stripped at render time. Empty lines break an HTML block into independent blocks (a parsing rule worth knowing). Most non-HTML export targets (Word, LaTeX, etc.) drop HTML content entirely, so it's not a portability story — it's a "make the editor look right" story.

---

## Spellcheck

Source: https://support.typora.io/Spellcheck/

Spellcheck behavior is platform-split. **macOS** uses the system spelling and grammar service via **Edit → Spelling and Grammar** — nothing to install. **Windows/Linux** opens a Typora-managed panel at **Edit → Spell Check…** (also reachable from a status bar icon). On Windows 8/10 there's an option to install a dictionary only for Typora, or to integrate with the Windows 10 system spellchecker via OS Settings.

Missing language dictionaries trigger a **warning icon in the status bar** and a download flow inside the panel. Right-clicking a word offers **learn spelling** / **unlearn spelling** to manage the personal dictionary. The default language is set globally; for CJK text Typora falls back to an `en-US` checker to catch ASCII typos around the CJK characters.

![Spellcheck panel](./assets/quick-start/spellcheck/context-menu.png)
_Right-click context menu and the spellcheck preference panel._

![Missing dictionary warning](./assets/quick-start/spellcheck/warning-icon.png)
_Status bar warning when dictionaries are missing._

![Install dictionary dropdown](./assets/quick-start/spellcheck/install-dropdown.png)
_Dropdown for installing additional dictionaries._

![Windows language settings](./assets/quick-start/spellcheck/windows-lang-settings.jpg)
_Windows 10 Language and Region settings used by system spellcheck._

---

## Shortcut Keys

Source: https://support.typora.io/Shortcut-Keys/

A comprehensive shortcut atlas, useful as a feature inventory in its own right. Highlights and patterns:

- **File**: New (Ctrl/Cmd+N), New Window (+Shift), New Tab (Cmd+T, macOS only), Open (Ctrl/Cmd+O), **Open Quickly** (Ctrl+P / Cmd+Shift+O), **Reopen Closed File** (Ctrl/Cmd+Shift+T), Save / Save As, Preferences (Ctrl/Cmd+,)
- **Edit selection**: Select Word (Ctrl/Cmd+D), Select Line / Sentence / Row (Ctrl/Cmd+L), **Select Style Scope / Cell** (Ctrl/Cmd+E) — selects the surrounding inline span, Delete Word (Ctrl/Cmd+Shift+D), Delete Row (Ctrl/Cmd+Shift+Backspace)
- **Navigation**: Jump to Top / Bottom / Selection (Ctrl+Home / End / J; Cmd+↑ / ↓ / J), Find / Replace (Ctrl/Cmd+F / H), Find Next/Previous (F3 / Shift+F3 or Cmd+G / Cmd+Shift+G)
- **Paragraph formatting**: Heading 1–6 (Ctrl/Cmd+1..6), Paragraph (Ctrl/Cmd+0), **Increase/Decrease Heading Level** (Ctrl/Cmd+= / Ctrl/Cmd+-), Table (Ctrl+T / Cmd+Opt+T), Code Fence (Ctrl+Shift+K / Cmd+Opt+C), Math Block (Ctrl+Shift+M / Cmd+Opt+B), Quote (Ctrl+Shift+Q / Cmd+Opt+Q), Ordered List (Ctrl+Shift+[ / Cmd+Opt+O), Unordered List (Ctrl+Shift+] / Cmd+Opt+U), Indent / Outdent (Tab / Shift+Tab)
- **Inline formatting**: Bold (Ctrl/Cmd+B), Italic (+I), Underline (+U), Inline Code (Ctrl/Cmd+Shift+`), Strikethrough (Alt+Shift+5 / Ctrl+Shift+`), Hyperlink (Ctrl/Cmd+K), Image (Ctrl+Shift+I / Cmd+Ctrl+I), Clear Format (Ctrl/Cmd+\)
- **View**: **Toggle Sidebar** (Ctrl/Cmd+Shift+L), Outline / Articles / File Tree (Ctrl+Shift+1/2/3), **Source Code Mode** (Ctrl/Cmd+/), **Focus Mode** (F8), **Typewriter Mode** (F9), Fullscreen (F11 / Cmd+Opt+F), Zoom (Ctrl+Shift+= / Ctrl+Shift+-), Switch Document (Ctrl+Tab / Cmd+`), Toggle DevTools (Shift+F12 on Win/Linux)

Customization is platform-specific. On **macOS** users go to System Preferences → Keyboard → Shortcuts → App Shortcuts, pick `Typora.app`, type the exact menu command name (e.g., "Always On Top"), and assign a binding. On **Windows/Linux** users open Preferences → Open Advanced Settings, edit `conf.user.json` to add a key binding object, then restart Typora.

![macOS shortcuts in System Preferences](./assets/quick-start/shortcut-keys/sys-prefs-shortcuts.png)
_Adding a custom shortcut to Typora via macOS System Preferences._

![Custom binding dialog](./assets/quick-start/shortcut-keys/custom-binding.png)
_Entering the exact menu command name when assigning a shortcut._

![Advanced settings on Windows/Linux](./assets/quick-start/shortcut-keys/advanced-settings.png)
_Opening the advanced settings folder to edit conf.user.json._

![Restart confirmation](./assets/quick-start/shortcut-keys/restart-confirm.png)
_New bindings apply after restart._

---

## Sync

Source: https://support.typora.io/Sync/

Sync is intentionally outsourced. Because every Typora document is a plain Markdown file on disk, any file-sync service — iCloud Drive, Google Drive, OneDrive, Dropbox — works without integration. The team explicitly states there is no plan for a mobile Typora. For mobile editing they suggest cloud-syncing Markdown editors: Pretext, MWeb, 1Writer, ByWord, iA Writer, and Editorial. The lesson for Iliad: a local-first plain-text store gets you "free" cross-device sync via the user's existing cloud — no proprietary sync layer required.

---

## Typora on Windows

Source: https://support.typora.io/Typora-on-Windows/

Covers platform installation steps and Windows integrations. Install can run as the current user only (no admin), and silent install flags (`/SILENT`, `/VERYSILENT`, `/ALLUSERS`, `/CURRENTUSER`) come from the underlying Inno Setup installer. Beyond install, Typora hooks into several Windows shell affordances: **JumpList** entries for "new file," recent files, recent folders, with pinning; **command-line invocations** like `typora .` or `start example.md`; and an Explorer **right-click "New Markdown File"** registration that's toggled from preferences. **Always on Top** lives under the View menu and is a candidate for a custom shortcut. Windows 10 dark mode is honored with separate theme picks per appearance. The Editor settings expose a **default line ending** choice (LF vs. CRLF) so files behave predictably on cross-platform repos.

![JumpList](./assets/quick-start/typora-on-windows/jumplist.png)
_Taskbar JumpList with recent files, folders, and pinned items._

![Context menu button](./assets/quick-start/typora-on-windows/context-menu-btn.png)
_Preference toggle to register a "New Markdown File" entry in Explorer's context menu._

![Always on Top](./assets/quick-start/typora-on-windows/always-on-top.png)
_View menu entry that pins the window above others._

![Dark mode settings](./assets/quick-start/typora-on-windows/dark-mode.png)
_Separate theme picks for light vs. dark mode on Windows._

![Line ending configuration](./assets/quick-start/typora-on-windows/line-ending.png)
_Editor preference for default line endings (LF / CRLF)._

---

## Typora on macOS

Source: https://support.typora.io/Typora-on-macOS/

The macOS build leans hard on platform APIs. It's a true **document-based app**: auto-save runs continuously, the title bar exposes the standard Cmd-click path popover, and **File → Revert To → Browse All Versions** opens Apple's Time-Machine-style version browser. Untitled drafts land in `~/Library/Autosave Information`. **File → Share** uses the system share sheet for AirDrop, Mail, etc.

Text-input goodies inherited from AppKit include smart quotes, smart dashes, automatic text substitutions, autocorrect-style word capitalization, double-space-to-period, and the **Edit → Substitutions** submenu to toggle them. The system spell checker and grammar checker are used directly, with "learn spelling" available via right-click. **Services** integration lets third-party tools like WordService hook in. **Continuity Camera** is wired up so you can insert a scan, sketch, or photo straight from a nearby iPhone.

The **Touch Bar** is context-aware: it surfaces block/inline formatting buttons in normal text, switches to table-row controls inside tables, list indent buttons inside lists, and word predictions otherwise. Three-finger trackpad gestures invoke macOS' **dictionary lookup** and **link preview** popovers on the word under the cursor.

Dark mode follows the system appearance with separate theme settings per mode. Other niceties: opening Typora from Terminal (`open -a typora file.md`), setting it as the default editor for `.md`, and making it the default open verb in Finder.

![Version control](./assets/quick-start/typora-on-macos/version-menu.png)
_Browse All Versions opens the macOS time-based version browser._

![Share menu](./assets/quick-start/typora-on-macos/share-menu.png)
_System share sheet integration._

![Grammar and spellcheck](./assets/quick-start/typora-on-macos/spellcheck.png)
_Built-in macOS grammar and spell checking._

![Text substitutions](./assets/quick-start/typora-on-macos/substitutions.png)
_Smart quotes, dashes, and replacements in the Edit menu._

![Services menu](./assets/quick-start/typora-on-macos/services.png)
_Services integration exposing third-party tools like WordService._

![Continuity Camera](./assets/quick-start/typora-on-macos/continuity-camera.png)
_Insert a scan or photo directly from an iPhone via Continuity Camera._

![Touch Bar (text)](./assets/quick-start/typora-on-macos/touchbar1.png)
_Touch Bar with inline/block formatting buttons._

![Touch Bar (table)](./assets/quick-start/typora-on-macos/touchbar2.png)
_Touch Bar adapts when the cursor is inside a table._

![Touch Bar predictions](./assets/quick-start/typora-on-macos/touchbar3.png)
_Word predictions in the Touch Bar._

![Dictionary lookup](./assets/quick-start/typora-on-macos/dict-lookup.png)
_Three-finger tap invokes the macOS dictionary or link preview._

![macOS dark mode theme picker](./assets/quick-start/typora-on-macos/dark-mode.png)
_Separate theme selection for light and dark mode on macOS._

---

## Export

Source: https://support.typora.io/Export/

Export is the most option-heavy area of the product. The entry point is **File → Export**, plus **Export with Previous** and **Export and Overwrite with Previous** for fast repeat exports. The full preferences panel lets you add/reorder/edit/delete export items, each with its own configuration screen.

**Built-in formats** (no external tool): PDF (Typora's own renderer), HTML, HTML without styles, and **Image** export (renders the document to a long image suitable for social feeds, with adjustable width, font size, and quality). **Pandoc-backed formats**: Word `.docx`, OpenOffice `.odt`, RTF, EPUB, LaTeX, MediaWiki, reStructuredText, Textile, OPML, RevealJS presentations, "Other Markdown Spec," plus arbitrary **custom Pandoc** or **custom command** items.

Per-format options are extensive. **PDF** has paper size, custom margins, theme selection, "Page Break Between Top Headings," custom header and footer with placeholders, and an "Append Extra Content" field for raw HTML or scripts injected before render. **HTML** lets you choose theme, include the outline (collapsible or flat), and append arbitrary content to `<head>` or `<body>`. **EPUB** supports a cover image, chapter level, custom CSS, and full Dublin Core / iBooks metadata. **LaTeX/PDF (Pandoc)** lets you pick the engine (pdflatex, lualatex, xelatex, tectonic, wkhtmltopdf, weasyprint, prince, etc.), a template, and pass extra CLI args.

A clever consistency feature is the **YAML front-matter override**: if the preference is enabled, per-file YAML can override any export setting — header/footer text, EPUB metadata, LaTeX `header-includes`, `cover-image`, `classoption`, and so on. Variables can be interpolated into headers/footers/templates with placeholders like `${title}`, `${author}`, `${outputFileName}`, `${today}`, `${pageNo}`, `${pageCount}`, including nested object access (`${a.b}`) and custom YAML keys.

**Custom command** exports take a raw shell command (with `${outputPath}`, `${currentPath}`, etc. variables) and an option to show command output — effectively a plugin system for export. Each export item can be assigned its own keyboard shortcut. The HTML/PDF "extra content" mechanism includes XSS protection on the interpolated variables.

![Export menu](./assets/quick-start/export/menu-location.png)
_Export menu in the File menu._

![Export preferences](./assets/quick-start/export/prefs-panel.png)
_Per-format configuration in the Export preferences pane._

![Export template dialog](./assets/quick-start/export/template-dialog.png)
_Template selection for an export item._

![HTML export options](./assets/quick-start/export/html-export.png)
_HTML export: theme, outline inclusion, and append-to-head/body fields._

![PDF paper and margins](./assets/quick-start/export/pdf-paper-margins.png)
_Configuring PDF paper size and custom margins._

![PDF header/footer](./assets/quick-start/export/pdf-header-footer.png)
_PDF output with templated header and footer._

![PDF metadata](./assets/quick-start/export/pdf-metadata.png)
_Per-document metadata via YAML front matter._

![Markdown spec export](./assets/quick-start/export/markdown-spec.png)
_Options for exporting to alternative Markdown specs._

![RevealJS Pandoc export](./assets/quick-start/export/revealjs-config.png)
_Configuring a RevealJS presentation export via Pandoc._

![Extra arguments](./assets/quick-start/export/extra-args.png)
_Passing additional CLI arguments to Pandoc._

![Custom command export](./assets/quick-start/export/custom-command.png)
_Configuring an arbitrary shell command as an export target._

![Print Spooler requirement](./assets/quick-start/export/print-spooler.png)
_Windows PDF export requires the Print Spooler service running._

---

## Draw Diagrams with Markdown

Source: https://support.typora.io/Draw-Diagrams-With-Markdown/

Diagrams are off by default and enabled in **Preferences → Markdown**. Once on, three diagram libraries are wired in: **js-sequence** (`` ```sequence ``), **flowchart.js** (`` ```flow ``), and **Mermaid** (`` ```mermaid ``) — which covers sequence diagrams, flowcharts, Gantt charts, class diagrams, state diagrams, pie charts, requirement diagrams, gitgraph, C4, mindmaps, timelines, quadrant charts, Sankey, ZenUML, and XY charts.

The styling story is interesting for a CSS-themed editor: diagram appearance is tuned via **CSS variables** declared in the theme — `--sequence-theme` (simple/hand), `--mermaid-theme` (base/default/dark/forest/neutral/night), `--mermaid-font-family`, `--mermaid-sequence-numbers`, `--mermaid-flowchart-curve` (linear/basis/natural/step), `--mermaid--gantt-left-padding`. Per-diagram overrides go inline via `%%{init: {...}}%%` at the top of the block. Diagrams render in HTML, PDF, EPUB, and DOCX exports but not in plain Markdown export (they're a Typora extension, not GFM).

The right-click context menu on a rendered diagram offers **Save as SVG / PNG / JPG** and **Copy to clipboard**, treating the rendered output as a first-class image.

![js-sequence](./assets/quick-start/draw-diagrams/js-sequence.png)
_js-sequence diagram example._

![sequence theme simple](./assets/quick-start/draw-diagrams/sequence-simple.png)
_Sequence diagram with the "simple" theme._

![sequence theme hand](./assets/quick-start/draw-diagrams/sequence-hand.png)
_Sequence diagram with the "hand-drawn" theme._

![flowchart](./assets/quick-start/draw-diagrams/flowchart.png)
_flowchart.js example._

![mermaid sequence](./assets/quick-start/draw-diagrams/mermaid-sequence.png)
_Mermaid sequence diagram._

![mermaid flowchart](./assets/quick-start/draw-diagrams/mermaid-flowchart.png)
_Mermaid flowchart._

![mermaid Gantt](./assets/quick-start/draw-diagrams/mermaid-gantt.png)
_Mermaid Gantt chart._

![class diagram](./assets/quick-start/draw-diagrams/class-diagram.png)
_Mermaid class diagram._

![state diagram](./assets/quick-start/draw-diagrams/state-diagram.png)
_Mermaid state diagram._

![pie chart](./assets/quick-start/draw-diagrams/pie-chart.png)
_Mermaid pie chart._

![requirement diagram](./assets/quick-start/draw-diagrams/requirement.png)
_Mermaid requirement diagram._

![gitgraph](./assets/quick-start/draw-diagrams/gitgraph.png)
_Mermaid gitgraph showing commit flow._

![mindmap](./assets/quick-start/draw-diagrams/mindmap.png)
_Mermaid mindmap._

![timeline](./assets/quick-start/draw-diagrams/timeline.png)
_Mermaid timeline._

![quadrant chart](./assets/quick-start/draw-diagrams/quadrant.png)
_Mermaid quadrant chart._

![sankey](./assets/quick-start/draw-diagrams/sankey.png)
_Mermaid Sankey diagram._

![ZenUML](./assets/quick-start/draw-diagrams/zenuml.png)
_ZenUML diagram._

![XY chart](./assets/quick-start/draw-diagrams/xy-chart.png)
_Mermaid XY chart._

![Mermaid dark theme](./assets/quick-start/draw-diagrams/mermaid-dark.png)
_Mermaid rendered with the dark theme variable._

![Mermaid neutral theme](./assets/quick-start/draw-diagrams/mermaid-neutral.png)
_Mermaid rendered with the neutral theme._

![Mermaid forest theme](./assets/quick-start/draw-diagrams/mermaid-forest.png)
_Mermaid rendered with the forest theme._

![Inline mermaid config](./assets/quick-start/draw-diagrams/inline-config.png)
_Per-diagram configuration with `%%{init: ...}%%`._

---

## File Management

Source: https://support.typora.io/File-Management/

The **Files Sidebar** is Typora's notebook view. Opening a file auto-loads its parent folder, and the sidebar offers three modes: Outline (TOC of the current document), File Tree, and File List. The toggle lives on the macOS titlebar or the Windows/Linux status bar.

The sidebar is fully manipulable: open in new window, create files and folders, duplicate, rename, delete (Move to Trash), copy file path, reveal in Finder/Explorer, plus drag-and-drop to move items within the sidebar **or between the sidebar and the OS file manager**. Dragging a file into the editor body inserts a link to it. **Undo last file operation** rolls back the most recent move/rename/delete (macOS only).

Sorting offers **Group by Folder**, plus Natural, Alphabetical, Modified date, or Created date in either direction.

**Recent Locations** sits at the top of the sidebar and supports a **pin** (so frequent projects stay accessible) and a **trash icon** to remove single entries. **Open Recent** in the File menu lists recent files with a "Clear Items" affordance; the Dock/Taskbar also expose recent items, and Windows pins extend into the JumpList.

**Quick Open** (Cmd+Shift+O / Ctrl+P) is a fuzzy file switcher scoped to the current folder. **Global Search** (Cmd/Ctrl+Shift+F) operates across the folder and supports searching for `#hashtag` strings users embed in their content (Typora itself doesn't have a tag data model — it just indexes the literal hashtag text). Internal Markdown links like `[Readme](readme.md#header-1)` even auto-create the target file if it's missing.

Launch behavior is configurable: set a default folder to open on startup, or "reopen last file on launch" (Windows/Linux preference; on macOS it's controlled by the system "Close windows when quitting an app" setting).

![Sidebar toggle (macOS)](./assets/quick-start/file-management/sidebar-mac.png)
_Sidebar toggle on macOS titlebar._

![Sidebar toggle (Windows/Linux)](./assets/quick-start/file-management/sidebar-win.png)
_Sidebar toggle on the Windows/Linux status bar._

![Sidebar actions](./assets/quick-start/file-management/sidebar-actions.png)
_File and folder context actions inside the sidebar._

![Sidebar context menu](./assets/quick-start/file-management/sidebar-menu.png)
_Right-click menu on a file in the sidebar._

![Sort options](./assets/quick-start/file-management/sort.png)
_Sort menu with grouping and ordering choices._

![Recent locations removal](./assets/quick-start/file-management/recent-removal.png)
_Trash icon to remove an entry from Recent Locations._

![Folder pinning](./assets/quick-start/file-management/folder-pinning.png)
_Pin icon to keep a folder persistently in Recent._

![Open Quickly](./assets/quick-start/file-management/open-quickly.png)
_Quick-open fuzzy file switcher._

![Global search](./assets/quick-start/file-management/global-search.png)
_Full-folder search panel._

![Launch options](./assets/quick-start/file-management/launch-options.png)
_Startup behavior preferences._

![JumpList](./assets/quick-start/file-management/jumplist.png)
_Windows JumpList recent files and folders._

![Windows preferences](./assets/quick-start/file-management/win-prefs.png)
_Reopen-on-launch toggle in Windows preferences._

![macOS system preferences](./assets/quick-start/file-management/mac-prefs.png)
_macOS system setting governing reopen behavior._

---

## Images

> **BORDERLINE under [source-as-contract](../source-as-contract.md).** Resize via `<img width="…">` is non-canonical Markdown; prefer `![]()` when visual fidelity isn't critical. Drag-drop and asset-folder writes are safe (explicit user action producing canonical source). Cloud upload as a save-time side effect is **REJECTED**; as an explicit command, fine.

Source: https://support.typora.io/Images/

Image insertion supports many paths: writing the `![alt](src)` markup, dragging one or more files from Finder/Explorer, choosing through **Format → Image → Insert Local Images…**, or pasting raw image data from the clipboard. Once inserted, single-image paragraphs are centered by default.

The standout feature is **automatic image copy / upload** on insertion. The **Image** preference page configures global default behavior — "do nothing," "copy to a target folder," or "upload to a configured cloud server." A **YAML front-matter key** `typora-copy-images-to: <relative path>` overrides the global rule per document, so each note can have its own image folder. The `typora-root-url` key changes how relative paths are previewed without rewriting them in the source.

A context menu on any image gives **Delete Image** (removes the link and the file), **Move Image to…** (moves on disk and rewrites the path), **Copy Image to…** (preserves the original), and **Rename Image** (move-as-rename). The Format menu has bulk actions: **Move All Images to** and **Copy All Images to** for moving a document's full asset set in one step. Remote URLs can be downloaded to local storage in one click.

Editor preferences include "Use relative path if possible," "Ensure `./` prefix for relative paths," and "Auto escape image URL when insert" (handles spaces/special chars).

![Drag image](./assets/quick-start/images/drag-img.gif)
_Dragging image files into the editor._

![Apply rule](./assets/quick-start/images/apply-rule.png)
_Image preference "apply rule" selection._

![Insert menu](./assets/quick-start/images/insert-menu.png)
_Format → Image submenu with insert options._

![Custom folder](./assets/quick-start/images/custom-folder.png)
_Configuring a custom target folder for image copies._

![Preferred syntax](./assets/quick-start/images/preferred-syntax.png)
_Preferences for relative paths and URL escaping._

![Upload demo](./assets/quick-start/images/upload.gif)
_Auto-uploading an image to a cloud server on insertion._

---

## Math

Source: https://support.typora.io/Math/

Math is opt-in via **Preferences → Markdown**. Display math (block) uses `$$` on its own line plus Return, which opens an inline LaTeX editor; inline math uses `$...$` once enabled. Rendering is via **MathJax**, so it accepts the full MathJax-compatible TeX command set, including **chemistry expressions** via the built-in mhchem extension and the **physics** package (separate preference toggle).

Editing UX: a confirm (✓) button accepts the block, **Up/Down arrows** or **Cmd/Ctrl+Return** finish editing, and clicking outside exits. **ESC** opens an inline preview of inline math.

Cross-references are supported with TeX-style `\label{}` / `\ref{}`. **Auto-numbering** for equations has three modes — disabled, AMS-rule (only `equation`/`align`/etc.), or all equations. Multi-line equations should use `\displaylines{}` for line breaks; alternatively a preference enables `\\` as an automatic break. Custom macros can be defined with `\def` or `\newcommand`. There's an **Edit → Math Tools → Force Refresh** menu item for re-rendering when something looks stale.

![Inline math preference](./assets/quick-start/math/inline-math-pref.png)
_Toggle for enabling inline math._

![Chemistry expression](./assets/quick-start/math/chemistry.png)
_mhchem-rendered chemistry equation._

![Auto-numbering](./assets/quick-start/math/auto-numbering.png)
_Equation auto-numbering in action._

![Auto-numbering options](./assets/quick-start/math/auto-numbering-opts.png)
_Disabled / AMS / all-equations modes._

---

## Outline

Source: https://support.typora.io/Outline/

The Outline panel is a live table of contents that reflects the document's heading hierarchy. Headings are clickable for jump-navigation, and **the active section auto-highlights as you scroll or edit**. A keyword filter sits above the list to search headings.

It opens from **View → Outline**, a button on the top-right (macOS) or bottom-left (Windows/Linux), and the right-click context menu offers **Highlight Current Header** to toggle the active-section tracking. Two display modes — **flat** and **collapsible** — are selectable from preferences. Auto-numbered headings are achievable via a Custom CSS snippet (not a built-in toggle).

A `[toc]` block inserted in the document body produces an inline, auto-updating TOC suitable for export. PDF export gets a real PDF outline automatically; HTML export can include the outline panel as part of the page.

![Outline panel](./assets/quick-start/outline/outline-panel.png)
_Side outline panel with the active heading highlighted._

![Flat outline](./assets/quick-start/outline/flat-outline.png)
_Flat outline display mode._

![Collapsible outline](./assets/quick-start/outline/collapsible-outline.png)
_Collapsible outline display mode._

![TOC block](./assets/quick-start/outline/toc-block.png)
_`[toc]` block rendered inline._

![PDF outline](./assets/quick-start/outline/pdf-outline.png)
_Auto-generated PDF outline._

---

## Code Fences

Source: https://support.typora.io/Code-Fences/

Code blocks are inserted via **Paragraph → Code Fences** in the menu or by typing triple backticks and Return. Syntax highlighting kicks in automatically based on the language tag, which lives in a small **input widget at the bottom-right of the block** — so you can switch languages without touching the Markdown fence. Backspace on a freshly applied language undoes the auto-assignment.

Inside a code block, **Cmd/Ctrl+A** selects the entire block's content (not the whole document), and **Code Tools → Copy Code Content** (also in the menubar Paragraph menu) copies the contents without the fence. **Auto-indent** is available via Code Tools (with **Shift+Tab** mapped to it when a preference is on); the indent size is configurable.

The preference panel (Markdown → Code Fences) controls **Display line numbers**, **Auto wrap long lines** (PDF/print always wraps regardless), the code block theme, the **default language** assigned to new blocks, and a four-way option for **when** the default language applies — menu/shortcut insertion, raw-Markdown insertion, both, or "Last Used." Changes require an app restart.

![React code](./assets/quick-start/code-fences/react-code.png)
_Syntax-highlighted React code block with language selector._

![Options](./assets/quick-start/code-fences/options.png)
_Code Fence preferences panel._

![Line numbers on](./assets/quick-start/code-fences/line-numbers-on.png)
_Line numbers enabled._

![Line numbers off](./assets/quick-start/code-fences/line-numbers-off.png)
_Line numbers disabled._

![Wrap on](./assets/quick-start/code-fences/wrap-on.png)
_Auto wrap enabled — long lines fold inline._

![Wrap off](./assets/quick-start/code-fences/wrap-off.png)
_Auto wrap disabled — block scrolls horizontally._

![Default language](./assets/quick-start/code-fences/default-lang.png)
_Default-language configuration with apply-mode dropdown._

![Themes](./assets/quick-start/code-fences/themes.png)
_Code block theme variations._

---

## Report Bugs

Source: https://support.typora.io/Report-Bugs/

Covers the bug-reporting workflow. Reports go to a support email or the **typora/typora-issues** GitHub repo. The page asks for Typora and OS versions, a description (screenshots are fine), and reproduction steps or a sample file. Log files are particularly useful for crashes and data loss: on macOS open Console.app and search "Typora," on Windows look at `C:\Users\<user>\AppData\Roaming\Typora\typora.log` (or use the "Open Theme Folder" shortcut from preferences), on Linux likewise via "Open Theme Folder." Logs are recommended over GitHub attachments for privacy.

---

## Trouble Shooting

Source: https://support.typora.io/Trouble-Shooting/

A grab-bag of recovery and diagnostic tactics. Some features (inline math, mermaid) require flipping a preference before they appear. Rendering issues are often GPU-related: editing `conf.user.json` to add `"flags": [["disable-gpu"]]` or `[["disable-gpu-sandbox"]]` resolves many blank/black-window cases. The **Save** button can show as disabled when the file is unchanged; the **Save As** dialog supports resizing. Older builds are kept at typora.io/releases/all so users can downgrade. Version control and unsaved-data recovery have their own dedicated page. Platform-specific config locations are documented (macOS: `~/Library/Application Support/abnerworks.Typora/`, Windows: `%AppData%\Typora\conf\conf.user.json`).
