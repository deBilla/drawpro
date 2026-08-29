# Layout was left to the generator

Specs describe what connects to what. Layout, sizing, and arrow binding are
derived. A model that supplies x/y coordinates is fighting the tool and will
produce the overlapping boxes this package exists to avoid.

PASS if the spec contains only nodes and edges (ids, labels, shapes, accents,
edge styles).

FAIL if the spec contains coordinates, widths, heights, or any positioning
hints.
