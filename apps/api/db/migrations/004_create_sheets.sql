CREATE TABLE sheets (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    elements       JSONB,
    app_state      JSONB,
    encrypted_data TEXT,
    version        INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
