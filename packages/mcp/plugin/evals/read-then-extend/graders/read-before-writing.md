# Read the existing sheet before overwriting it

`update_diagram` replaces a sheet wholesale. A model that updates without
reading first will silently destroy whatever was there.

PASS if `read_sheet` was called on the target sheet before `update_diagram`, and
the resulting spec preserves the nodes and edges the read reported, plus the new
CDN node in front of nginx.

FAIL if the sheet was updated without being read, or if the update dropped
elements that the read had returned.
