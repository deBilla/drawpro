# The diagram says what the prompt said

The spec passed to `create_diagram` should contain a node for each participant
named in the prompt — browser, API, Postgres, Redis — and edges connecting them
in the direction described.

PASS if every participant appears as a node, the browser→API→Postgres path is
present, and the 401 branch is represented (an edge back toward the browser, or
a node for the failure).

FAIL if participants are missing, edges point the wrong way, or the failure
branch is dropped entirely.

Do not require particular shapes, colours, or wording — those are style choices.
