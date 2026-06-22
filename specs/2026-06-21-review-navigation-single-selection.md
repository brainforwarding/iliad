# Review Navigation Single Selection

## Problem

When a virtual pending delete review is active, clicking another pending changed file can briefly open that file and then snap the editor back to the deleted-file review. The file tree can also show two selected rows: the virtual deleted file as active and the clicked real file as selected.

## Expected Behavior

- Manual navigation to another real file clears any stale virtual create/delete review target unless it points at the same relative path.
- Opening a virtual create/delete review clears the real-file selection, because the active row is synthetic.
- A pending delete review remains visible only when it is explicitly selected or when its real file is the active file.
- A new external review batch never jumps to the first changed file. It may auto-open review only when the file already open in the editor is part of that batch.
- Accepting/restoring one review item never advances to the next review item automatically.
- The file tree shows one selected/active row for review navigation.

## Tests

- A pending delete review target is cleared when the active file changes to another relative path.
- A pending delete review target is kept when the active file still matches the deleted file relative path.
- A virtual create/delete review clears the selected real path when selected.
- External active-file targeting chooses the current document from a multi-file proposal instead of the first changed file.
