# Typora What's New — 0.x Beta Series

> Own-words summaries of Typora's 0.x beta releases, for use as inspiration for Iliad. Newest first. Source URLs link to the release notes.

> **Verdict reminder.** Release notes below describe features that may or may not pass [`../source-as-contract.md`](../source-as-contract.md). Before adopting any idea from this changelog, check it against the rule — features that mutate the source silently (smart punctuation, save-time uploads, snippet expansion, embedded HTML for layout) are **REJECTED** regardless of how recently Typora shipped them.

## 0.11 — 2021-07-12

Source: https://support.typora.io/What%27s-New-0.11/

### Highlights

- MathJax was bumped to 3.2 for faster math rendering. When TeX fails to compile, errors now appear underneath the still-rendered math instead of replacing it, so authors can keep editing.
- Several extra TeX packages are now usable inside math blocks: `cases`, `centernot`, `colortbl`, `empheq`, `gensymb`, `mathtools`, `textcomp`, `upgreek`, `braket`, `physics`, `xypic`.
- Flowchart syntax learned named branches for diagrams.
- Hyperlinks gained explicit affordances: "Open Link" (also via Ctrl/Cmd-click) and "Copy Link Address" entries in the Format menu and the right-click menu.

### Editor and Markdown spec

- Toggle for whether saved files should end with a trailing newline.
- macOS text-replacement now works inside code blocks and math blocks.
- YAML front matter accepts the spec-compliant `...` closing delimiter in addition to `---`.
- Fenced code blocks better handle nested fences when you use extra backticks or tildes (CommonMark / GFM compatible).
- Ordered lists can start with `1)` as well as `1.`.
- GFM tables can omit leading/trailing pipes; header row cell counts must match the delimiter row.
- Smart quotes / smart dashes no longer mangle URLs or inline code, and pressing Undo brings the original character back.

### Export

- Export reports surface warnings (not just hard failures).
- New "Export Setting…" entry exposed under the Export menu.

### Platform: Windows / Linux

- Keyboard shortcuts are shown next to commands in context menus.
- Alt+E / Alt+P / Alt+O open the top-level menus when running in unibody (single-bar) mode.
- The Windows tile background and Start menu integration was fixed.
- File list and tree sorting now matches Windows Explorer's alphabetical order.

### Dialogs and i18n

- Dialog buttons can be reached via Tab, arrow keys, and confirmed with Enter.
- Romanian was added as an interface language.

### Various fixes

Image copy, table context menus, table edit persistence, preferences panel UI, cursor after emoji, word count when text is selected, link-text Unicode handling, list-style toggles, and a hint/link to set the Pandoc path when missing.

![Keyboard shortcuts shown inside context menus](./assets/whats-new-0x/0.11/context-menu-shortcuts.png)
_Windows/Linux context menus now display each command's shortcut on the right._

![Dialog button navigation](./assets/whats-new-0x/0.11/dialog-navigation.gif)
_Tab and arrow keys move focus between dialog buttons; Enter confirms._

![Hyperlink "Open Link" action](./assets/whats-new-0x/0.11/hyperlink-actions.png)
_The Format menu and the context menu now expose Open Link and Copy Link Address._

![Hyperlink context menu](./assets/whats-new-0x/0.11/hyperlink-context-menu.png)
_Right-clicking a link surfaces link-specific commands._

![Export setting menu entry](./assets/whats-new-0x/0.11/export-settings-menu.png)
_New "Export Setting…" entry inside the Export menu._

![Windows unibody Alt menu access](./assets/whats-new-0x/0.11/windows-menu-access.png)
_Alt+letter shortcuts open top-level menus when the title bar hosts the menu._

![colortbl TeX package](./assets/whats-new-0x/0.11/tex-colortbl.png)
_Coloured table cells supported via the colortbl package._

![gensymb TeX package](./assets/whats-new-0x/0.11/tex-gensymb.png)
_Degree, ohm, and similar symbols via gensymb._

![mathtools TeX package](./assets/whats-new-0x/0.11/tex-mathtools.png)
_Extra math layout primitives via mathtools._

![textcomp TeX package](./assets/whats-new-0x/0.11/tex-textcomp.png)
_Text-mode symbols via textcomp._

![upgreek TeX package](./assets/whats-new-0x/0.11/tex-upgreek.png)
_Upright Greek letters via upgreek._

![physics TeX package](./assets/whats-new-0x/0.11/tex-physics.png)
_Bra-ket and derivative notation via physics._

![xypic TeX package](./assets/whats-new-0x/0.11/tex-xypic.png)
_Commutative diagrams via xypic._

![Flowchart named branches](./assets/whats-new-0x/0.11/flowchart-named-branches.png)
_Flowchart blocks can now label conditional branches._

![Romanian interface](./assets/whats-new-0x/0.11/romanian-translation.png)
_Romanian added to the available UI languages._

---

## 0.10 — 2021-04-20

Source: https://support.typora.io/What%27s-New-0.10/

### Highlights

- The whole export pipeline was overhauled. Users can save multiple named export presets (e.g., one PDF profile per project), re-run the previous export with one click, set a default output folder per item, choose a post-export action (reveal, open, run a command, or nothing), and override the Pandoc path manually.
- New per-format export controls: PDF gets page size / margins / headers and footers / metadata / dedicated export theme; HTML gets an optional outline sidebar, a separate theme, custom scripts, and YAML meta passthrough; image export gets configurable font size and image width; Word export gains underline (with newer Pandoc), `<br/>` support, and reference docx for theming; arbitrary Pandoc formats can be added with custom arguments or a fully custom shell command.
- New code-fence language autocomplete picks the highlighter from a popup as you type the language tag.
- Tables now support a single row (header only), Tab adds a new row, and pasting tables from Google Sheets and similar sources works correctly.
- App and document icons got redesigned (a system cache clear is sometimes needed on upgrade).

### Diagrams

- Mermaid behaviour is now driven by CSS variables, so themes can ship their own diagram defaults: `--mermaid-theme`, `--mermaid-sequence-numbers`, `--mermaid-flowchart-curve` (linear/basis/natural/step), `--mermaid--gantt-left-padding`, and `--sequence-theme` (simple/hand).

### Platform tweaks

- macOS Big Sur re-introduces the class (sidebar-integrated) window mode with a Classic option and a Seamless default.
- Windows can install per-user without admin rights (admin still recommended).
- Hebrew was added as a UI language.

### Editor / fixes

- Duplicate heading anchors are now disambiguated.
- Fixes for highlight rendering, list indent in code fences, line breaks in image/link titles, math deletion via context menu, `<samp>` support, link click whitespace, the `json5 → json` alias, search bugs, duplicate math labels, macOS dictation, sidebar sort on launch, and click responsiveness on Windows panels. The "Move to Trash" label was renamed to "Delete".

![Redesigned app and file icons](./assets/whats-new-0x/0.10/icon-redesign.png)
_Updated Typora and Markdown file icons._

![Code-fence language autocomplete](./assets/whats-new-0x/0.10/code-fence-autocomplete.png)
_Typing a language name after the fence shows a popup of supported highlighters._

![Refreshed context menu](./assets/whats-new-0x/0.10/context-menu.png)
_Reworked context menu, here on the Windows GitHub theme._

![Export presets panel](./assets/whats-new-0x/0.10/export-interface.png)
_The new export configuration UI lets you maintain named export profiles._

![PDF headers and footers](./assets/whats-new-0x/0.10/pdf-header-footer.png)
_PDF export now supports configurable page headers and footers._

![Single-row table](./assets/whats-new-0x/0.10/single-row-table.gif)
_Tables can now consist of just a header row; Tab appends a new row._

![macOS Classic mode](./assets/whats-new-0x/0.10/macos-classic.png)
_Big Sur "Classic" window style with a visible title bar._

![macOS Seamless mode](./assets/whats-new-0x/0.10/macos-seamless.png)
_Big Sur "Seamless" window style merges the title area into the editor._

![Windows per-user installer](./assets/whats-new-0x/0.10/windows-user-install.png)
_Windows installer now offers a per-user install path._

![Hebrew interface](./assets/whats-new-0x/0.10/hebrew-translation.png)
_Hebrew localisation added._

![Mermaid sequence numbers off](./assets/whats-new-0x/0.10/sequence-numbers-off.png)
![Mermaid sequence numbers on](./assets/whats-new-0x/0.10/sequence-numbers-on.png)
_Toggle for numbered messages in sequence diagrams._

![Flowchart linear curve](./assets/whats-new-0x/0.10/flowchart-linear.png)
![Flowchart basis curve](./assets/whats-new-0x/0.10/flowchart-basis.png)
![Flowchart natural curve](./assets/whats-new-0x/0.10/flowchart-natural.png)
![Flowchart step curve](./assets/whats-new-0x/0.10/flowchart-step.png)
_Four mermaid flowchart connector styles, selectable via CSS variable._

![Sequence diagram simple theme](./assets/whats-new-0x/0.10/sequence-simple.png)
_The simple sequence-diagram theme._

---

## 0.9.98 — 2020-12-06

Source: https://support.typora.io/What%27s-New-0.9.98/

### Highlights

- Native Apple Silicon (M1) build for macOS Big Sur.
- Theme management was redesigned: themes are now picked from Preferences, and you can configure separate themes for light and dark mode. Themes can also react to the OS color scheme via the `prefers-color-scheme` CSS media query. Two new built-in variants: Gothic Dark and Whitey Dark.
- Mermaid was upgraded to 8.8.3 and exposes a `--mermaid-theme` CSS variable with values `base`, `default`, `dark`, `forest`, `neutral`.

### Editor and i18n

- Arabic UI was added.
- A new option lets Windows/Linux users insert an em dash via shortcut, useful for languages where it is common typography.
- Highlighting added for Q, V (vlang), and Forth.
- Image-content copy works inside the editor; IME compatibility, Find & Replace, Open Quickly, and typewriter triple-click were all polished.
- File context menus gained "Get Info" on macOS and "Properties" on Windows.
- Print improvements; PDF export honours more third-party themes; Pandoc compatibility widened.

### Security and fixes

- Fixed a macOS XSS vulnerability; escaped URL handling and launch-argument errors corrected.

![Native Apple Silicon support](./assets/whats-new-0x/0.9.98/m1-mac-support.png)
_Native build running on an M1 MacBook._

![Arabic interface](./assets/whats-new-0x/0.9.98/arabic-interface.png)
_New Arabic localisation._

![Em-dash insertion option](./assets/whats-new-0x/0.9.98/em-dash-option.png)
_Windows/Linux preference for inserting em dashes via shortcut._

![Theme picker in Preferences](./assets/whats-new-0x/0.9.98/theme-preferences.png)
_Choose separate light and dark themes from the Preferences panel._

![Gothic Dark and Whitey Dark themes](./assets/whats-new-0x/0.9.98/gothic-whitey-dark.png)
_New dark-mode theme variants shipped with Typora._

![Mermaid dark theme](./assets/whats-new-0x/0.9.98/mermaid-dark.png)
![Mermaid forest theme](./assets/whats-new-0x/0.9.98/mermaid-forest.png)
![Mermaid neutral theme](./assets/whats-new-0x/0.9.98/mermaid-neutral.png)
_Three of the new mermaid theme presets._

---

## 0.9.90 — 2020-07-10

Source: https://support.typora.io/What%27s-New-0.9.90/

### Highlights

- Mermaid 8.5.2: invalid diagrams show an inline error message rather than failing silently; sequence diagrams support link styles and loops; new (experimental) entity-relationship diagrams.
- Files saved as UTF-8 with BOM are supported.
- Azure-style `[[_TOC_]]` is recognised as a table-of-contents directive.
- HTML `id` attributes can now serve as anchor targets, in addition to the legacy `<a name>` pattern.

### Configuration and editing

- Image upload paths accept `${filename}` and `${filepath}` variables.
- A documentation entry for launch arguments and a "configure custom shortcuts" button were added.
- ABAP code highlighting added.
- Better table parsing rules, typewriter-mode tweaks, refreshed built-in themes, and improved sidebar sorting.

### i18n

- Turkish and Swiss German added; Japanese, Polish, Czech updated.

### Various fixes

Math after inline comments, image-block indentation, table row deletion, source/hybrid cursor restore, reference links with encoded URLs, image copy/paste/upload, Ctrl+Tab on macOS, Cmd-click on the title bar, print dialog, and a sharper macOS PDF export.

![Mermaid inline error message](./assets/whats-new-0x/0.9.90/mermaid-error-message.png)
_Invalid mermaid blocks show what went wrong instead of disappearing._

![Sequence diagram with links and loops](./assets/whats-new-0x/0.9.90/sequence-links-loops.png)
_Sequence diagrams gain styled links and loop blocks._

![Entity-relationship diagram](./assets/whats-new-0x/0.9.90/entity-relationship.png)
_Experimental ER diagram type._

---

## 0.9.84 — 2020-02-22

Source: https://support.typora.io/What%27s-New-0.9.84/

### Highlights

- Image upload is now available on every desktop OS. Built-in integrations: uPic on macOS, PicGo-Core and PicGo.app cross-platform, plus a custom-command escape hatch for any other backend.
- Footnote navigation is bidirectional: footnote definitions render a back-arrow, and Ctrl/Cmd-clicking a footnote reference jumps to the definition.

### Editing

- Spellcheck ignores HTML entities like `&nbsp;` and skips footnote labels (which are usually abbreviations).
- Local images that fail to load auto-retry when the window regains focus.
- Theme CSS files with CJK characters in their filenames work.
- Search/replace refinements.

### i18n

- Persian added; Danish, Japanese, Russian, Swedish, and a Swiss German variant improved.

### Platform and security

- Mermaid pie-chart styling polished.
- macOS/Windows stability fixes.
- The Windows auto-update flow now shows download progress and total size, and the "check updates automatically" checkbox no longer sticks on.
- An mXSS vulnerability and a number of cursor-positioning bugs (after inline-style toggles, near soft breaks, at line ends with Shift+Arrow) were fixed.

![Image upload demo](./assets/whats-new-0x/0.9.84/image-upload.gif)
_Drag an image and let Typora upload it via the configured backend._

![Footnote round-trip navigation](./assets/whats-new-0x/0.9.84/footnote-return.gif)
_Click a footnote to jump down; click the return arrow to come back._

![Auto-updater progress on Windows](./assets/whats-new-0x/0.9.84/auto-update-progress.png)
_The Windows updater now reports total and downloaded size._

---

## 0.9.80 — 2019-11-30

Source: https://support.typora.io/What%27s-New-0.9.80/

### Highlights

- Three new mermaid diagram types: class diagrams (with inheritance and methods), state diagrams, and pie charts.
- Find & Replace separates "Find" from "Find Next" so the selected match behaves predictably; the Night theme has better contrast on search highlights.

### Editing

- Smarter spellcheck of super/subscript text and contractions like "don't".
- Pasting links no longer leaves stray whitespace; large pastes are faster; HTML-to-Markdown conversion was tightened.
- Files panel uses a more natural sort.
- Auto-link works on relative paths in the clipboard; quote auto-pairing is smarter.
- Better arrow-key navigation and list rendering.

### Export

- No more accidental ligatures in PDF; macOS page setup is respected; internal and HTML anchor links survive PDF/HTML export.

### Fixes and i18n

- Mermaid XSS plugged; HiDPI text alignment fixed; mermaid diagrams now appear in exported `.docx`.
- IME crashes (Sougou on Windows, macOS system IME during PDF export) resolved.
- Danish and Ukrainian added; Japanese, Polish, Czech updated.

![Class diagram](./assets/whats-new-0x/0.9.80/class-diagram.png)
_Mermaid class diagrams support inheritance and method lists._

![State diagram](./assets/whats-new-0x/0.9.80/state-diagram.png)
_State diagrams visualise transitions and workflows._

![Pie chart](./assets/whats-new-0x/0.9.80/pie-chart.png)
_Quick pie-chart visualisation in mermaid syntax._

---

## 0.9.73 — 2019-08-03

Source: https://support.typora.io/What%27s-New-0.9.73/

### Highlights

- The Preferences panel was rebuilt for clarity, and the macOS version added a search box so you can hunt for a setting by name.
- Menus were reorganised: table operations moved to the Paragraph menu (and each one now has a customisable shortcut); image operations consolidated under Format; macOS "Camera Continuity" lives in Format too.
- Zoom is now available on every platform from the View menu, with a configurable toggle, plus two-finger trackpad pinch on newer macOS versions.
- Dark mode on macOS 10.14+ got better UI coverage, including scrollbar colours and Preferences inputs.
- Windows ships a custom updater that quits Typora before installing.

### Editor

- Smalltalk syntax highlighting added.
- Mermaid gantt rendering improved.
- A reading-speed (words per minute) preference drives the estimated read-time stat.
- Option to auto-escape URLs when inserting images.
- Images have their own context menu.
- macOS app is notarised.

### Various fixes

Export to image on macOS, sidebar refresh after deletion, HTML export styles, special-character handling in global search (e.g. `#`), file auto-reload on Windows/Linux, saving remote images locally, plus other minor bugs.

![Redesigned Preferences panel](./assets/whats-new-0x/0.9.73/preferences-panel.png)
_The Preferences panel was rebuilt with cleaner grouping._

![Table operations under the Paragraph menu](./assets/whats-new-0x/0.9.73/table-menu.png)
_All table commands live in the Paragraph menu and accept custom shortcuts._

![Image operations under Format](./assets/whats-new-0x/0.9.73/image-menu.png)
_Image-related commands consolidated under the Format menu._

![Zoom on every platform](./assets/whats-new-0x/0.9.73/zoom-demo.png)
_Zoom is now available from the View menu on all platforms._

![Zoom feature toggle](./assets/whats-new-0x/0.9.73/zoom-feature.png)
_A View-menu toggle controls magnification behaviour._

---

## 0.9.71 — 2019-06-20

Source: https://support.typora.io/What%27s-New-0.9.71/

### Highlights

- Windows and Linux moved to Electron 5.0 for a performance bump.
- File panel can sort in descending order; common ignored files (`.git`, etc.) no longer count as changes; renames and additions are smoother; multi-window edits of the same document stay in sync; Unicode handles correctly in search and quick-open.
- Code fences highlight ASN.1, Gherkin, SPARQL, and Crystal.
- PDF export auto-zooms oversized mermaid diagrams, math blocks, and tables so they fit the page; broken links/images in PDF and missing CSS rules were fixed.
- HTML export uses human-readable anchor slugs.

### Editor and security

- Remote image hosts that previously blocked Typora now load; `<img>` accepts more attributes including `align`.
- A hyperlink-based code execution vulnerability and a CPU-exhaustion DoS via huge mermaid diagrams were patched.
- Night theme polish; line-break rules unified across modes.

### i18n

- Catalan added; Portuguese (Portugal) spellcheck fixed; Traditional Chinese, Japanese, and Polish improved.

### Various fixes

Chinese IME quoting/bracketing, cursor jumping after emoji or Shift+Enter, `$` swallowing in headings, ampersand escaping, URL parsing, inline-math source font.

_No screenshots in the source page for this release._

---

## 0.9.66 — 2019-03-11

Source: https://support.typora.io/What%27s-New-0.9.66/

### Highlights

- Drag-and-drop a file into the editor to insert a link to it.
- Emoji autocomplete is enabled by default.
- Flowchart library updated with rendering fixes.
- Reading-speed preference for the estimated read-time stat.
- Oz language added to syntax highlighting.

### Security and i18n

- Rotation-based XSS plugged in export, math, and iframe contexts.
- Vietnamese and Indonesian translations added; Russian, Japanese, and Polish updated.

### Notes

- Search performance and PDF-export compatibility were improved.
- Outline rendering and click-jump issues fixed, along with auto-pairing, math block rendering, and footnote numbering on export.
- The release notes flag that Linux 32-bit support will be dropped soon when Typora moves off Electron 3.x.

_No screenshots in the source page for this release._

---

## 0.9.63 — 2019-01-25

Source: https://support.typora.io/What%27s-New-0.9.63/

### Highlights

- Windows JumpList integration: recently opened folders appear when you right-click the Typora taskbar icon, and frequently used items can be pinned. The File → Open Recent menu can clear the list.
- The Open Quickly dialog splits results into "recent files" and "files in the current working folder" and refreshes on file open or rename.
- Sidebar tweaks: hovering a tree/list item shows the full path, and the outline panel now treats the whole row as a click target. An XSS in the sidebar was fixed.
- New "Copy without theme styling" command preserves semantic HTML tags like `<strong>` while dropping CSS like custom colours, fonts, and line-heights.

### Math and source mode

- MathJax mhchem upgraded to 3.3 (`\pu`, `\xrightarrow`, etc.); auto-numbering fixed on Windows/Linux.
- Source-code mode picked up a basic context menu on Windows/Linux.

### Various fixes

macOS 10.10 crash, remembered maximised window state on Windows/Linux, cursor jumps in block quotes and task lists, Markdown parsing rules, spellcheck panel issues.

![Windows JumpList](./assets/whats-new-0x/0.9.63/jump-list.png)
_Recent and pinned folders surface in the Windows taskbar jump list._

![Open Quickly dialog](./assets/whats-new-0x/0.9.63/open-quickly.png)
_Open Quickly groups recent files and files from the current folder._

---

## 0.9.61 — 2019-01-08

Source: https://support.typora.io/What%27s-New-0.9.61/

### Highlights

- Global search: a Search icon in the side panel (macOS) or scrolling the side panel up (Windows/Linux) opens project-wide search, with Cmd/Ctrl+Shift+F as a shortcut. The sidebar can also be hidden via the title bar or status bar.
- File tree got drag-and-drop: reorder files in the sidebar, drag in from Finder/Explorer, or drag a file onto the editor to insert a link to it.

### Word count and search

- The word-count pill can default to character count, word count, line count, or read time; it stays visible in macOS fullscreen.
- Outline gained a filter for quick navigation.
- Preferences search on Windows/Linux (matches the current UI language and English).

### File operations

- Confirmation dialogs for move/delete, undo support for the most recent file op, changed files highlighted in the sidebar, and a "Duplicate file" context-menu entry.

### Other

- COBOL syntax highlighting.
- MathJax 2.7.5 upgrade.
- More compact table rendering.
- "Disable GPU Acceleration" preference on Windows/Linux.
- Portuguese split into separate Portugal and Brazil locales; Galician added.

### Various fixes

`<img>` XSS, invisible Linux menu bar, duplicate image copies, math equation regressions in PDF/Docx, mermaid margins and link behaviour.

![Global search in the sidebar](./assets/whats-new-0x/0.9.61/global-search.png)
_New project-wide search panel inside the sidebar._

![Word-count statistic picker](./assets/whats-new-0x/0.9.61/word-count-stats.png)
_Choose which stat the word-count indicator shows by default._

![Searchable Preferences panel](./assets/whats-new-0x/0.9.61/preferences-search.png)
_Filter Preferences entries by typing on Windows and Linux._

![Search on support.typora.io](./assets/whats-new-0x/0.9.61/support-search.png)
_The Typora support site picked up search at the same time._

---

## 0.9.59 — 2018-10-23

Source: https://support.typora.io/What%27s-New-0.9.59/

### Highlights

- Spellcheck for non-English languages on Windows/Linux; an "unlearn spelling" option appears in the context menu.
- Dark mode: when the OS reports dark mode the main window follows along, and the Preferences panel adapts to it.
- File tree can sort by alphabet, natural order, or modified date.

### UI and performance

- Sidebar width is remembered between sessions.
- Entering typewriter or focus mode for the first time shows an explanatory notification (so it doesn't feel like a glitch).
- Typing latency reduced; scrolling smoother; file open and Windows install faster; remote-image paste no longer freezes macOS.

### Various fixes

Caret moves during inline-math editing, math rendering updates, "preserve whitespace and line break" honoured during PDF export, PDFs open cleanly in Adobe Acrobat/Reader on macOS, auto-pairing, and image-storage path updates on file switch. Analytics moved off Google to a self-hosted server.

![Spellcheck context menu](./assets/whats-new-0x/0.9.59/spellcheck-context.png)
_Spellcheck suggestions and "unlearn spelling" inside the context menu._

![Typora following system dark mode](./assets/whats-new-0x/0.9.59/dark-mode-1.png)
_The main window adopts the OS dark appearance._

---

## 0.9.58 — 2018-09-11

Source: https://support.typora.io/What%27s-New-0.9.58/

### Highlights

- Configurable "copy images to folder on insert" path. The path can be absolute, relative (`./` / `../`), or use `${filename}` substitution that is also wired into YAML front matter variables.
- Math block right-click → "Math → Copy as MS Word" lets you paste a math block into Word on Windows.

### Fixes and security

- Critical fix: pasting text into a table could silently lose data when switching files.
- Paste inside lists, remote image loading, `<video><source>` rendering, Windows saving when there's no Documents folder, and Windows/Linux menu auto-hide in fullscreen all corrected.
- Tightened the permissions on `<iframe>` elements using local sources (reported by Zhiyang Zeng of Tencent Blade Team).
- macOS requirement bumped to 10.10.

![Custom image-copy folder setting](./assets/whats-new-0x/0.9.58/custom-image-folder.png)
_New preference for the folder Typora copies pasted images into._

---

## 0.9.54 — 2018-08-14

Source: https://support.typora.io/What%27s-New-0.9.54/

### Highlights

- Inline styles survive a single hard line break inside the source, so bold/italic/etc. can wrap across lines and so multi-line DOT, PlantUML, and UMLGraph diagrams render via Gravizo.
- Broader inline HTML: `<span>`, `<ruby>`, `<kbd>`, and HTML entities all render alongside Markdown styles. Block-level HTML renders as an editable HTML block (enter the block by clicking inside, or Ctrl/Cmd-click). `<video>`, `<audio>`, and `<iframe>` work for embeds. (Note: `id`, `class`, and `data-*` attributes are stripped.)
- macOS Dock menu now exposes quick actions.
- Math block UI was redesigned and now coexists with pandoc-crossref styling. Table, math, and search panels were polished.

### Code blocks and i18n

- Pasting code from a web page tries to detect Gist blocks and language; tsx, stylus, and julia highlighting added; `sqlite` typo fixed.
- Swedish added.

### Various fixes

Return key / undo-redo inside tables, paragraph indent rendering, Korean IME, Spanish keyboard, menu/title sync when switching sidebars, Select All with mixed inline content, scroll position while editing code/math blocks, smart-quote/smart-pants Pandoc export, and search starting from the cursor position.

![Dock Menu quick actions](./assets/whats-new-0x/0.9.54/dock-menu.png)
_macOS Dock now exposes Typora quick actions._

![Refreshed math block UI](./assets/whats-new-0x/0.9.54/math-block-ui.png)
_Redesigned math-block editing UI._
