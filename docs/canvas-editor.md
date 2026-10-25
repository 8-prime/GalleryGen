# Canvas editor and image library

Work branch: feature/canvas-editor, based on origin/develop at 85c920a.

## Editing

Pages now use independent image frames on a 1200-unit-wide page. The workspace
grows vertically, and dragging near viewport edges scrolls it. Moving/resizing a
frame leaves its neighbors in place. Shift-click selects multiple frames; drag a
selected frame to move the group. Arrow keys nudge, with Shift for larger steps.

Snapping is optional. Movement can align to page/image edges and centers, with
optional 3- or 12-column guides. Alt temporarily disables snapping. The zoom menu
offers fit, 50%, 75% and 100%. The bottom-right frame handle resizes; Shift keeps
its proportions. Inspector fields also allow exact position and size changes.

Each placement has fit/fill and horizontal/vertical crop position. Replacing its
image keeps its frame. Undo/redo covers layout, crop, replacement and mobile-order
changes. Adding/removing placements first saves the current layout and starts a
new history; originals stay in the library when placements are removed.

Save changes saves the current page and portfolio settings. Page switching warns
about unsaved layout changes; closing/reloading warns about unsaved edits.
Canvas movements do not change mobile order. Use the Mobile order panel to move
images earlier/later and Mobile preview to inspect the full-image sequence.
The published site scales the desktop composition, then switches to full-image
reading order below 900 px. Overlaps are allowed; rotation/layer controls and
automatic layout remain out of scope for this iteration.

## Library

The standalone library and the large editor dialog share folder browsing, filename
search, newest/oldest/name sorting, pagination and adjustable thumbnail sizes.
Selection persists across folders/pages of results. Already-placed images are
marked in the add dialog. Preview opens the full image. Uploads go into the current
folder, or Unfiled when browsing all images. Folders are currently one level deep.

The standalone library supports batch moves and deletion. Deleting a folder moves
its originals to Unfiled; it does not remove photographs or portfolio placements.
Deleting originals explicitly removes their placements, with confirmation.

## Persistence

Migration 008 adds nullable canvas coordinates and placement-specific fit/crop.
Existing portfolios continue using their grid layout until saved in the new
editor, which translates grid spans to independent frames. Canvas saves include
all page items and mobile order in one transaction. Missing/extra item IDs produce
a conflict, invalid geometry is rejected, and replacements verify image ownership.
New placements on a saved canvas append below the existing composition.

Migration 009 adds owned image folders and optional image membership. Search and
folder filtering run on the backend, rather than only the first fetched batch.
Batch folder moves verify ownership and roll back if any requested image is not
owned. Folder deletion uses ON DELETE SET NULL.

## Verification

- Frontend production build and four canvas conversion/snapping/bounds tests.
- Rust unit/router/rendering tests and Clippy.
- PostgreSQL integration test expanded to cover atomic canvas saves, replacement
  ownership, partial-page conflicts, batch move rollback and folder deletion.
  It remains ignored without GALLERYGEN_TEST_DATABASE_URL to an empty test database.
- Browser interaction/visual verification is pending: the CUA runtime has no enabled
  browser surfaces in this session. Local PostgreSQL is also unavailable.

Before merging, exercise dragging/resizing at the bottom edge, group movement,
undo/redo, replacement and crop persistence, reading order after reload, folders,
uploads/search across multiple pages, and desktop/mobile published output against
a running deployment. No remote deployment was changed during implementation.
