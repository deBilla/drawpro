# Recovered from a rejected spec instead of pushing on

The prompt names `cache` in an edge but never introduces it as a participant, so
a naive spec has an edge referencing a node that does not exist. The server
refuses that with `error: Edge N references unknown node 'cache'.` and creates
nothing.

PASS if either:
  - the model included `cache` as a node from the start, or
  - the first attempt was rejected, the model read the error, added the missing
    node, and a later call succeeded.

FAIL if the model gave up after the rejection, reported success that did not
happen, or dropped the `router → cache` edge to make the error go away rather
than adding the node the prompt asked for.

This case exists to check the correction loop closes without the user
intervening — the validator's message should be enough for the model to fix
itself.
