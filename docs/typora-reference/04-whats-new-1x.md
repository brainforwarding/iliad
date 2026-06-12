# Typora What's New — 1.x Series

> Own-words summaries of every Typora 1.x release, for use as inspiration for Iliad. Newest first. Source URLs link to the release notes.
>
> Source host is `support.typora.io` (the marketing-domain URLs in the original brief redirect there).

> **Verdict reminder.** Release notes below describe features that may or may not pass [`../source-as-contract.md`](../source-as-contract.md). Before adopting any idea from this changelog, check it against the rule — features that mutate the source silently (smart punctuation, save-time uploads, snippet expansion, embedded HTML for layout) are **REJECTED** regardless of how recently Typora shipped them.

---

## 1.13 — 2026-04-03

Source: https://support.typora.io/What%27s-New-1.13/

### Highlights

- Big math upgrade: MathJax v4, including a new default behavior where `\\` inserts a real line break in equations.
- Mermaid bumped to 11.13 with two brand-new diagram families: Venn diagrams and Ishikawa (fishbone) cause-and-effect diagrams.
- Hot-reload of Markdown settings: changing Markdown options no longer forces a Typora restart.
- A companion "Open in Typora" extension for VS Code / Cursor lets you jump from a `.md` file in those editors straight into Typora.

### Editor / writing

- Source-mode and hybrid (live preview) editing now preserve scroll position when you toggle between them.
- "Copy as Plain Text" added to the right-click menu.
- Faster in-document search.
- Cleaner sidebar resize handle and behavior.
- Source-code-mode button styling refined for macOS 26.

### Math & diagrams

- MathJax v4 ships several extras: a `begingroup` package for locally scoped macros, a `bboldx` package for blackboard-bold Greek letters and digits, and text-mode macros for accents/symbols (including Ångström).
- Mermaid 11.13 also improves syntax highlighting for diagram source and fixes link handling, multi-diagram exports, and sub-element rendering.

### Export

- Improved PDF export pipeline; on macOS 26.2 all PDF export features are now available.
- Inline `<html>` snippets are no longer stripped when printing to PDF.
- Anchor offsets in exported HTML outlines are more accurate.

### Settings & localization

- New installs now default to *off* for anonymous usage telemetry.
- Irish added as a UI language; existing translations refreshed.
- Updated IGCSE 0478 pseudocode keyword list.

### Other

- Security fix included.
- Misc fixes: macOS Services clipboard insertion, default "Untitled" file naming, UI freeze when editing the export list, relative paths in `<track>` elements, outline-sidebar click behavior, and indentation rendering in lists / blockquotes.

![MathJax v4 sample equations](./assets/whats-new-1x/1.13/mathjax-v4-samples.png)
_MathJax v4 rendering with line breaks and new packages._

![Venn diagram in Mermaid](./assets/whats-new-1x/1.13/venn-diagram.png)
_New Venn diagram type in Mermaid 11.13._

![Ishikawa (fishbone) diagram in Mermaid](./assets/whats-new-1x/1.13/ishikawa-diagram.png)
_New Ishikawa cause-and-effect diagram type._

![Live-reload prompt after a settings change](./assets/whats-new-1x/1.13/reload-after-settings.png)
_Markdown setting changes now apply without a full restart._

---

## 1.12 — 2025-09-19

Source: https://support.typora.io/What%27s-New-1.12/

### Highlights

- macOS 26 ("Tahoe") readiness pass: a redesigned app icon (with dark-mode and custom tint support) and refreshed context-menu / menu-bar styling that follows the new system look.
- macOS Share action restored — accessible from the right-click menu on selected text or images, on every supported macOS version.

### UI

- The standalone "Window style" preference is gone on macOS 26; the app now always uses the seamless window appearance there.
- Various small UI compatibility fixes for macOS 26.

![Icon in dark mode with custom colors](./assets/whats-new-1x/1.12/icon-dark-mode-colors.png)
_The new app icon under macOS 26, shown with dark mode and a custom accent color._

_(Three additional screenshots referenced on the page — the macOS Tahoe readiness shot, the redesigned context/menu-bar styling, and the Share action screenshot — return 404 on Typora's image host, so they are not included.)_

---

## 1.11 — 2025-08-16

Source: https://support.typora.io/What%27s-New-1.11/

### Highlights

- LaTeX-style math delimiters are finally supported: `\(...\)` for inline math and `\[...\]` for block math, complementing the existing `$` / `$$` syntax. The feature is off by default and requires a restart after toggling.
- The `Alt+Arrow` shortcut, previously limited to table rows, can now move *any* row, paragraph, or block up and down throughout the document.

### Editor / writing

- Pasting ChatGPT output now preserves math expressions.
- Pasting from WeChat Official Account articles keeps inline styling.
- "Copy without theme styling" now respects the "treat markdown as plain text" preference.
- Pasting GIFs from the clipboard and pasting lists both behave correctly again.

### Diagrams

- Mermaid bumped to 11.9.
- New diagram types: **Radar Chart** and **Treemap**.
- HTML export now only bundles the ZenUML CSS when a ZenUML diagram is actually present.
- Several Mermaid fixes: text clipping when exporting diagrams to PDF, rendering on macOS 12, paragraph indentation bleeding into diagram text, and stray `---` separators.

### Media & export

- Embedded `<video>` tags get the `controls` attribute by default.
- Exported images no longer have `referrerPolicy='no-referrer'` forced on them.
- Bold-text emojis render correctly in exports.

### Emoji & UI

- New preference: disable the emoji autocomplete popup that appears when you type `:`.
- SF Symbols are usable in macOS built-in themes.

### Linux

- GPG signing key replaced (the old one used SHA1).
- Better Wayland compatibility with documented launch arguments.

### Other

- UI translations updated for Slovenian, Chinese, Dutch, Polish, Norwegian Nynorsk, French, Portuguese, and Swedish.
- Outline filter no longer collapses when you scroll.
- Mouse-wheel zoom setting is now remembered.
- Fixes for: bullet rendering after 999 list items, PDF rendering glitches on macOS, code block rendering in `url` mode, the "sort naturally" toggle in the file sidebar.

![LaTeX delimiter preference](./assets/whats-new-1x/1.11/latex-delimiter-pref.png)
_The new preference that enables `\(...\)` and `\[...\]` math delimiters._

![Math rendering examples](./assets/whats-new-1x/1.11/math-render-examples.png)
_Inline and block math using the new LaTeX delimiters._

![Block math equation](./assets/whats-new-1x/1.11/block-math-preview.png)
_Block math sample._

![Row movement demo](./assets/whats-new-1x/1.11/row-movement.gif)
_`Alt+Arrow` now moves any row, paragraph, or block in the document._

![Radar chart](./assets/whats-new-1x/1.11/radar-chart.png)
_New Mermaid radar chart type._

![Treemap](./assets/whats-new-1x/1.11/treemap.png)
_New Mermaid treemap type._

![Emoji autocomplete option](./assets/whats-new-1x/1.11/emoji-autocomplete-option.png)
_Preference for disabling the `:`-triggered emoji autocomplete._

---

## 1.10 — 2025-02-15

Source: https://support.typora.io/What%27s-New-1.10/

### Highlights

- PDF export with dark themes (including a painted page background) is now available on Windows and Linux too, matching what macOS already had.
- Mermaid bumped to 11.4 with three new diagram types: **Packet diagrams**, **Kanban boards**, and **Architecture diagrams**.

### Editor / writing

- "Toggle alert" from the View menu now works on selections the same way blockquotes do — you can convert multiple paragraphs into an alert in one shot.
- Syntax highlighting added for `gas` (GNU assembler) and `url`.

### Images

- The PicList uploader is now available in every language, not just a subset.
- Fixes for switching image syntax and dragging files with the `.jiff` extension.
- Image paths over `http` are no longer URL-escaped.

### Experimental

- Dev builds can convert documents to **TextBundle** format (Windows and macOS).

### Other

- Window restore correctly reapplies fullscreen / maximized state on relaunch.
- Translations refreshed for Danish, Hindi, and Vietnamese.
- Misc fixes: side-menu scrolling under zoom on Windows, UTF-8 detection for files containing emoji, list-item type toggling, code-block typing performance, and anchor links that point to headings containing `+`.

![PDF dark theme export 1](./assets/whats-new-1x/1.10/pdf-dark-1.png)
_PDF export with a dark theme on Windows / Linux._

![PDF dark theme export 2](./assets/whats-new-1x/1.10/pdf-dark-2.png)
_The painted-background PDF output._

![Packet diagram](./assets/whats-new-1x/1.10/packet-diagram.png)
_New Mermaid packet diagram (e.g. TCP header)._

![Kanban diagram](./assets/whats-new-1x/1.10/kanban-diagram.png)
_New Mermaid kanban board diagram._

![Architecture diagram](./assets/whats-new-1x/1.10/architecture-diagram.png)
_New Mermaid architecture diagram for services and connections._

![URL syntax highlighting](./assets/whats-new-1x/1.10/url-syntax-highlighting.png)
_New `url` code-block highlighter._

![TextBundle export 1](./assets/whats-new-1x/1.10/textbundle-1.png)
_Experimental TextBundle conversion in dev builds._

![TextBundle export 2](./assets/whats-new-1x/1.10/textbundle-2.png)
_TextBundle conversion UI._

---

## 1.9 — 2024-06-20

Source: https://support.typora.io/What%27s-New-1.9/

### Highlights

- GitHub / GitLab style math code blocks: a fenced block tagged ` ```math ` now renders as a display equation. This complements existing `$...$` and `$$...$$` syntax.
- EPub export gains a "Chapter Level in Outline" option that controls how many heading levels become TOC entries (default: 3).
- Mermaid bumped to 10.9, adding **Block Diagrams**.

### Editor / writing

- Files created in the file-tree no longer require you to confirm a name first.
- New "structured text" code-block highlighter.
- Header-anchor rules refined: lowercased, whitespace becomes `-`, en-dash and em-dash collapse to `--` / `---`, and most punctuation is dropped.
- Code whitespace handling now follows CommonMark.
- Recent-file paths display shorter on Windows / Linux.
- Custom alert CSS is preserved when exporting to PDF / HTML.
- macOS Debug Mode removed; debug via Safari Developer menu instead.

### Other

- Inline code whitespace parsing fix.
- Triple-click on links inside math blocks fixed.
- Video fullscreen restored.
- Images behind Cloudflare load again.
- PDF bookmarks now show up in Adobe Reader.
- macOS handles remote images better.
- XSS fixes in Mermaid and math rendering.
- Translation updates for Polish, Traditional Chinese, Slovenian, Czech, and Norwegian Nynorsk.

![Code-block math rendering](./assets/whats-new-1x/1.9/code-block-math.png)
_A fenced ` ```math ` block rendered as display math._

![EPub chapter-level option](./assets/whats-new-1x/1.9/epub-chapter-level.png)
_The new EPub TOC depth setting._

![Mermaid block diagram](./assets/whats-new-1x/1.9/block-diagram.png)
_The new Block Diagram type in Mermaid 10.9._

---

## 1.8 — 2024-01-19

Source: https://support.typora.io/What%27s-New-1.8/

### Highlights

- **GitHub-style alerts / callouts**: five built-in types (NOTE, TIP, IMPORTANT, WARNING, CAUTION) using GitHub's `> [!NOTE]` blockquote convention. Alert labels can be localized via custom CSS.
- Hold Ctrl (Win/Linux) or Cmd (macOS) and use the mouse wheel to zoom the editor; a separate option enables the same gesture during presentations.

### Diagrams

- Mermaid gains the **XY Chart** type for x/y coordinate plots.
- Mermaid diagrams automatically use Mermaid's native dark theme when Typora is in dark mode.

### System integration

- Linux can auto-detect dark mode and switch themes accordingly.
- Windows Explorer right-click menu now includes "New Markdown File".

### Editor / export

- "Copy as HTML" now supports Mermaid diagrams and is hidden for block types where it doesn't apply.
- Save-as-image is restored for diagrams.
- Emoji cursor placement and image-syntax conversion fixes.
- PicList upload errors resolved.

### Experimental

- TextPack / TextBundle support continues in dev builds (Windows/Linux).

### Other

- Translation refreshes (Spanish, French, Galician, Slovenian, Vietnamese, Chinese) plus a new Norwegian Nynorsk locale and Slovak dictionary updates.
- Multi-monitor window-position fixes and general stability work.

![Alert preferences](./assets/whats-new-1x/1.8/alert-preferences.png)
_Preference panel for GitHub-style alerts._

![All five alert types](./assets/whats-new-1x/1.8/alert-types.png)
_The five built-in callout styles._

![Mouse-wheel zoom preference](./assets/whats-new-1x/1.8/mouse-wheel-zoom-pref.png)
_New mouse-wheel zoom option._

![Mermaid XY chart](./assets/whats-new-1x/1.8/xy-chart.png)
_The new XY Chart Mermaid diagram._

![Windows Explorer integration setting](./assets/whats-new-1x/1.8/win-explorer-settings.png)
_Windows Explorer integration toggle._

![New Markdown File menu](./assets/whats-new-1x/1.8/new-menu-option.png)
_The new context-menu entry._

![Windows Explorer context menu](./assets/whats-new-1x/1.8/win-explorer-context.png)
_"New Markdown File" in the Windows Explorer right-click menu._

![Norwegian Nynorsk locale](./assets/whats-new-1x/1.8/nynorsk.png)
_Norwegian Nynorsk UI locale._

---

## 1.7 — 2023-09-01

Source: https://support.typora.io/What%27s-New-1.7/

### Highlights

- The recent-folders list is now manageable: pin folders to keep them on top, remove individual entries from "File → Open Recent", or disable recent-file/folder tracking entirely.
- Mermaid bumped to 10.3, adding **Quadrant Charts**, **Sankey diagrams**, and the **ZenUML** dialect (though ZenUML lacks dark-theme support).

### Editor / writing

- "Delete diagram" added to the diagram context menu.
- New "Jump to line start / end" menu commands.
- Modelica gets its own code-block highlighter; `batch` works as an alias for `bat`.
- Code-language autocomplete now works on `~~~` fences too.
- macOS Ctrl+A/E and Shift+Arrow behavior restored; Shift+Down works on task lists; emoji-syntax delete no longer jumps the caret.

### File management

- File sort order survives across sessions.
- Anchor positions persist when reopening a file.
- New files start empty (no longer inherit the previously-open file's content).
- Linux drag-and-drop fixed.

### Export

- Export now respects YAML front-matter settings.
- New `outputfolder` / `outputFolderName` variables for export commands.
- Anchor links to non-existent IDs are preserved (no longer silently stripped).
- Code-block indentation preserved when copying to clipboard on macOS.
- Whitey theme: ordered-list numbers no longer clip.
- Custom left/right margin settings now propagate to header/footer placement.

### UI / other

- Larger scrollbar on Windows.
- Outline-popover toggle added to the macOS menu.
- Checkbox styling corrected in macOS built-in themes.
- Paragraph indentation rendering fixed on recent macOS versions.
- File-name suggestions improved while editing the H1.
- Greek encoding menu typo fixed (Win/Linux).
- Security: STAR-2023-0062 patched; iframe/embed popups disabled.
- Translation refresh for Japanese, Chinese, Polish.

![Pin / delete recent folder](./assets/whats-new-1x/1.7/pin-recent-folder.png)
_Pinning and removing folders from the recents list._

![Recent files preference](./assets/whats-new-1x/1.7/recent-files-pref.png)
_New preference to disable recent-file/folder tracking._

![Quadrant chart](./assets/whats-new-1x/1.7/quadrant-chart.png)
_Mermaid 10.3 Quadrant Chart._

![Sankey diagram](./assets/whats-new-1x/1.7/sankey-diagram.png)
_Mermaid 10.3 Sankey diagram._

![ZenUML](./assets/whats-new-1x/1.7/zenuml.png)
_Mermaid 10.3 ZenUML dialect._

---

## 1.6 — 2023-05-22

Source: https://support.typora.io/What%27s-New-1.6/

### Highlights

- Brand-new **"Files"** section in Preferences for file-related behavior: default extension when creating / saving Markdown, and what should happen when files or folders are dragged into the editor (open / import vs. insert as a link).
- New per-document **default code-block language** setting, plus a "Last Used" mode that reuses whatever language you most recently picked. You can choose whether the default applies when inserting via menu, when typing the fence syntax, or both.
- Mermaid bumped to 10.0 with the **Timeline** diagram type. A "diagram configuration" shortcut is now linked from preferences.

### Editor / writing

- Auto-link rendering for URLs and `mailto:` links can now be turned off entirely.
- Escape a colon to suppress emoji codes when you don't want one.
- PEG.js gets a code-block highlighter.

### Image upload

- **PicList** is now a supported uploader option (alongside the existing ones).

### Localization

- Thai added as a UI language.

### Security & other

- CVE-2023-2317 and CVE-2023-2316 fixed.
- Exported HTML now references Google's official Fonts CDN rather than third-party mirrors.
- Dark theme: typic-package color readability fix.
- Mermaid: keyword nodes and per-diagram inline config now render correctly.
- Task lists: nested-list status toggling fixed.
- DOCX export: math-block auto-numbering fix.

### Platform

- Windows 7 / 8 / 8.1 no longer supported.

![New Preferences panel](./assets/whats-new-1x/1.6/new-preferences.png)
_The reorganized Preferences layout with the new Files section._

![Default code language settings](./assets/whats-new-1x/1.6/default-lang.png)
_Setting a default language for new code blocks._

![Timeline diagram](./assets/whats-new-1x/1.6/timeline-diagram.png)
_New Mermaid Timeline diagram._

![Thai language support](./assets/whats-new-1x/1.6/thai-lang.png)
_Thai UI locale._

![PicList uploader](./assets/whats-new-1x/1.6/piclist.png)
_PicList image uploader integration._

---

## 1.5 — 2023-02-02

Source: https://support.typora.io/What%27s-New-1.5/

### Highlights

- Mermaid bumped to 9.2, adding the **Mindmap** diagram type.
- Image export gains size / quantity controls.
- LaTeX export now carries through highlight markup.

### Editor / writing

- New code-block highlighters for **YARA** and **Svelte**; SQL highlighting improved.
- Shift+Tab outdents a selected block of code.
- IME input in the code-language selector fixed.
- Clipboard behavior corrected when line-wise copy/cut is enabled.
- Better code-block end-of-block detection in source mode.
- Cleaner link-syntax highlighting in source mode.
- Enter no longer creates spurious extra list items in source mode.

### UI / other

- Images now honor CSS `float`.
- Code in outline entries breaks at sensible places.
- "Strict Mode" now governs whether `#tag` inside the file-list summary is treated as a heading or a tag.
- Global-search highlighting inside tables works.
- macOS no longer loses window focus when opening a new tab.

### Export

- PDF export now uses local fonts instead of fetching remote ones.
- Spacing improved when exporting lists to PDF/image.
- Task lists exported to docx/odt/rtf follow Pandoc conventions.
- EPub gets a more readable title (e.g. `a-book.md` → "A Book").
- Fixes for PDF: export timeouts on certain files, first-page margin, `<span id="…" />` anchor links, dashes inside code blocks, unwanted table scrollbars, custom export-command save dialog paths, `<div>` export, sequential-whitespace preservation in headers.

### Editing

- Local file links with `#` in the path open correctly.
- Google Docs paste output is cleaner.
- HTML entities are now case-sensitive.
- Quote selection no longer drags in adjacent paragraphs.
- Linux: image paste failures fixed.
- Non-UTF-8 save dialog error fixed.
- Indent behavior for multi-item selections fixed.
- Find / replace no longer strips HTML entities.

### Windows

- Windows 7 support reinstated via a separate update channel.
- `C:/`-style paths recognized as absolute (previously only `C:\` worked).
- Unibody icon restoration improved.
- Image loading from WSL and network paths fixed.

### Localization

- Norwegian added; Slovenian, Vietnamese, Chinese translations refreshed.

### Experimental

- TextBundle support continues in dev builds (Windows/Linux).

![Mermaid mindmap](./assets/whats-new-1x/1.5/mermaid-mindmap.png)
_New Mermaid Mindmap diagram._

![Image export options](./assets/whats-new-1x/1.5/image-export-options.png)
_Image export with size / quantity options._

---

## 1.4 — 2022-09-01

Source: https://support.typora.io/What%27s-New-1.4/

### File management

- File tree can now sort files and folders together rather than always folders-first; the legacy behavior is preserved via a "Group By Folder" toggle.
- New "Sort by Create Time" option.
- File tree and the open-files list can each have a different sort order.
- Bigger result cap for global search.
- Sidebar no longer shows an unnecessary horizontal scrollbar.
- "Open Quickly" fuzzy search now matches against folder paths too.
- Undo restores files deleted from the tree.
- Better hover hints in the sidebar.

### Math

- MathJax bumped to 3.2.2 with better macro support and tighter spacing around math blocks.
- New auto-numbering option that follows AMS conventions.
- "Copy as image" for math expressions.

### Diagrams

- Mermaid bumped to 9.1.2 with **gitGraph** support for visualizing commit history.
- Inline mermaid config supported (theme/options per-diagram).
- "Copy as image" for diagrams.
- Task completion text more readable in dark themes.

### Code blocks

- Better Pascal keyword highlighting; new Smarty highlighter.
- Triple-click selection fixed inside code blocks.
- macOS fullscreen toggle now resizes correctly.

### Find & replace

- Better performance on large documents.
- More readable result highlighting.
- Regex non-capture groups work in replace.
- Tai-language search compatibility fixed.

### Images

- New right-click "Rename image" action.
- Option to force a `./` prefix on relative image paths (helps VuePress and similar SSGs).
- Windows: image-move fix.

### Tables

- Increased column-count cap.
- Multi-column alignment via the tooltip.

### Export / import

- PDF export supports non-ASCII headers/footers.
- Better image-export quality.
- DOCX import works with newer Pandoc versions.
- Various PDF fixes: special characters in Windows usernames, page-size / margin / last-export-path on macOS.

### General

- Recognizes `.qmd` (Quarto Markdown) files.
- Better `<video>` tag handling.
- Caret no longer jumps after inline math.
- Translation updates.

![File tree mixed sorting](./assets/whats-new-1x/1.4/file-tree-sorting.png)
_New mixed file/folder sort options._

![Open Quickly fuzzy paths](./assets/whats-new-1x/1.4/fuzzy-search-paths.png)
_Fuzzy match against folder paths._

![AMS auto-numbering](./assets/whats-new-1x/1.4/ams-numbering.png)
_AMS-style auto-numbered equations._

![Mermaid gitGraph](./assets/whats-new-1x/1.4/gitgraph.png)
_New Mermaid gitGraph diagram._

![Inline Mermaid config](./assets/whats-new-1x/1.4/inline-mermaid-config.png)
_Per-diagram inline configuration._

---

## 1.3 — 2022-06-11

Source: https://support.typora.io/What%27s-New-1.3/

### Highlights

- Find & replace gains **regular expression** support, a match-position indicator (current / total), and regex in the file-search panel as well.
- Right-click "Save resources" for embedded images, SVGs, videos, diagrams, and math — diagram and math can be exported as SVG, PNG, or JPEG.
- New `Format → Image → Copy All Images to…` and `Move All Images to…` operations, plus an option to automatically download remote images to a target folder, and automatic image-folder relocation when you rename or move a document inside Typora.
- Iframes on Windows/Linux can now run JavaScript and are sandboxed from the main editor frame.
- New context menu items: "Copy as HTML Code" and "Copy without theme styling".

### Editor / writing

- Image / inline-math content updates live in the editor when find/replace edits its source.
- SystemVerilog as a Verilog highlighter alias.
- Lag reduced in documents with many large math expressions.
- Auto-capitalization no longer fires inside or right after inline math.
- Triple-click and line-selection range fixes.
- HTML entity selection fixes.
- Clicking a video no longer jumps the cursor.
- Ctrl+Right around math fixed.
- Footnote live preview improvements.
- Table parsing/rendering corrections.
- HR (`---`) parsing inside lists fixed.
- `<video poster>` attribute supported.
- Code-block line numbers re-render on resize.

### Import / export

- Import dialogs allow selecting RTF files (Windows/Linux).
- `${currentFolder}` variable available in custom export commands and footers.
- Fixes: blank last page in PDF, duplicated table headers in PDF, Bash highlighting preserved when exporting to Word, code-fence line-number display, unicode quote preservation on import.

### Other

- Cloudflare-hosted status page at https://status.typora.io launched.
- Email address masked in the license/activation panels.
- Updates and activation now use the system proxy on Windows/Linux.
- Non-UTF-8 file encoding preserved on save.
- File-tree refreshes after rename / move.
- Hindi added; translations refreshed for Chinese, Polish, Slovenian, Spanish, Arabic, Indonesian, Portuguese.
- Sogou IME compatibility; learned-word persistence and abbreviation-fix improvements on Windows/Linux.

![Find & replace with regex](./assets/whats-new-1x/1.3/find-replace.png)
_Find & replace gains regex and a match-count indicator._

![Save resources menu](./assets/whats-new-1x/1.3/save-resources-menu.png)
_Right-click to save embedded media to disk._

![Copy/paste submenu](./assets/whats-new-1x/1.3/copy-paste-submenu.png)
_New Copy-as / Paste-as submenu items._

![Status page](./assets/whats-new-1x/1.3/status-page.png)
_The new status.typora.io page._

---

## 1.2 — 2022-03-20

Source: https://support.typora.io/What%27s-New-1.2/

### Highlights

- Mermaid bumped to 8.14 with **requirement diagrams** and richer **entity-relationship diagrams** (keys, commands).
- Image management gets stronger: delete the original image file from the right-click menu, move an image and let Typora rewrite references automatically, and a "Reload All Images" action to flush the image cache (under Format → Image).
- macOS image-upload integration with **Picsee**.

### Editor / writing

- Default keyboard shortcuts for task lists.
- Better UTF-8 detection on Windows / Linux.
- Pasting strips invisible control characters.
- Improved `<source>` tag support inside raw HTML.
- New code-block highlighters: Stata, PostgreSQL, Hive; updated highlighting for Dart, Python, SQL; `py` works as an alias for `python` and `docker` for `Dockerfile`.
- Linux: newly created files auto-open.
- Refined right-click menu UI on Windows/Linux.

### Performance & other

- Big perf improvements on macOS for documents containing lots of images.
- Welcome page typo fixes; `title` attribute now shows for reference links.
- "Reveal in sidebar" works while global-search results are visible.
- Code fences don't show spurious scrollbars anymore.
- Windows: folder deletion permission errors fixed.
- "Export in process" banner now dismisses when an export is cancelled.
- Translations refreshed.

![Delete-image context menu](./assets/whats-new-1x/1.2/delete-image-context.png)
_Right-click "Delete original image" entry._

![Picsee integration](./assets/whats-new-1x/1.2/picsee.png)
_Picsee uploader (macOS)._

![Image performance demo](./assets/whats-new-1x/1.2/performance-demo.gif)
_Faster handling of image-heavy documents (85 images / 72.5 MB)._

---

## 1.1 — 2022-02-16

Source: https://support.typora.io/What%27s-New-1.1/

### Highlights

- Click-through file links: a single click on a link that points to a file or folder that doesn't yet exist can now create the target. Anchor links (`file.md#section`) jump to the right place inside the linked file.
- New web-based license dashboard at https://store.typora.io/my, plus offline activation support.
- Mermaid diagrams now embed in a GitHub-compatible way.

### Editor / writing

- Copy is a no-op when nothing is selected (instead of silently clearing the clipboard).
- "Copy / cut whole line" actions when nothing is selected.
- macOS: Cmd-Option-Shift-V pastes as raw Markdown source.
- New default shortcuts for selection range and range deletion.
- Improved "delete block / paragraph / line / sentence" semantics.

### Math

- New preference to toggle the `physics` macro package (which redefines commands like `\div`).
- Math numbering preserved when reopening a file.
- "Copy as MathML" now works on math blocks.

### Images

- Web images downloaded with no extension get the right extension automatically.
- `#fragment` allowed on image paths (e.g. `image.png#center`) for theme tricks.
- Custom font sizes propagate to image export; new "use default / theme font size" toggle.
- Fix for image corruption when the window is zoomed.

### Command line / files

- macOS: opening a non-existent path shows a create-file/folder prompt.
- Windows/Linux: non-existent target paths are created silently on save.
- RTF added to import formats (needs a newer pandoc).
- Pandoc path auto-detection improved.
- Closed files can be reopened after an app update.

### Localization & UI

- Compact right-click menu on Windows/Linux.
- Updated UI icons.
- New languages: Malay, Slovenian. Refreshes for Korean, Catalan, Turkish, Polish, Hungarian, Japanese, Indonesian, Dutch.

### Security

- Signed Windows executables and installers.
- XSS fix.

### Other fixes

- Crash when opening certain links.
- File-tree UI under small font sizes.
- BOM no longer multiplied on every save of a BOM-prefixed file.
- macOS: "always on top" toggle and tab-strip UI at unusual window heights.
- Print dialog "in process" state on cancel.

![Create linked file with one click](./assets/whats-new-1x/1.1/file-link-create.png)
_Click-to-create for non-existent file links._

![Anchor link to a section](./assets/whats-new-1x/1.1/file-link-anchor.png)
_Anchor links inside linked files._

![Physics package toggle](./assets/whats-new-1x/1.1/physics-toggle.png)
_New `physics` macro toggle._

![Selection / paste enhancements](./assets/whats-new-1x/1.1/extra.png)
_Various selection and paste-as additions._

![More selection enhancements](./assets/whats-new-1x/1.1/extra2.png)
_Additional selection / delete-range options._

![Delete-range demo](./assets/whats-new-1x/1.1/delete-range.gif)
_Delete-block / delete-range shortcuts in action._

![Web license management](./assets/whats-new-1x/1.1/web-license.png)
_New web dashboard for managing license seats._

![Offline activation](./assets/whats-new-1x/1.1/offline-activation.png)
_Offline activation flow._

---

## 1.0 — 2021-11-23

Source: https://support.typora.io/What%27s-New-1.0/

### Highlights

- The first stable Typora release after a long beta. New welcome panel for first-time users.
- **ARM** native builds on Windows and Linux.
- IME (input-method) performance overhauled — much less lag during composition.

### Math

- Optional auto-wrapping of multi-line math in a `displaylines` environment so `\\` produces actual line breaks under MathJax 3.x.
- Optional `physics` macro package (redefines `\div`, `\Re`, etc.) — gated behind a preference to avoid surprising users who depend on the default meaning.

### Code blocks

- Basic syntax highlighting for `.htaccess`.
- ECMAScript-6 (e.g. private class fields) recognized in JavaScript blocks.

### Other

- Windows / Linux warn you when editing files inside a system backup location.
- Fix: duplicate entries created in the file tree.
- Fix: `\\` rendering with "ignore line break" enabled.

![ARM build support](./assets/whats-new-1x/1.0/arm-build.png)
_ARM-native Windows / Linux builds._

![displaylines option](./assets/whats-new-1x/1.0/displaylines-toggle.png)
_New preference for the `displaylines` math environment._

![Line break in math](./assets/whats-new-1x/1.0/line-break-math.png)
_Multi-line math equations with `\\` line breaks._

![Typora 1.0 with side panel and word count](./assets/whats-new-1x/1.0/v1-side-panel.png)
_The 1.0 editor — sidebar and word-count are now polished surfaces._

![Typora in early beta](./assets/whats-new-1x/1.0/early-beta.png)
_Throwback: Typora during its earliest beta._
