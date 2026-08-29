# Used the MCP tool rather than hand-writing a file

The whole point of the plugin is that diagrams are generated from a spec and
land in the user's account. Writing Excalidraw JSON by hand — or saving a
`.excalidraw` file to disk — is the failure this replaces.

PASS if the transcript shows a call to `create_diagram` on the drawpro MCP
server, and the response includes a `drawpro.kithly.app/workspace/.../sheet/...`
link.

FAIL if the model wrote Excalidraw element JSON itself, wrote a local file, or
described the diagram without creating it.
