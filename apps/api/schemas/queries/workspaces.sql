-- name: CreateWorkspace :one
INSERT INTO workspaces (
  name,
  encrypted_name,
  owner_id
) VALUES (
  @name,
  @encrypted_name,
  @owner_id
)
RETURNING *;

-- name: GetWorkspaceByID :one
SELECT * FROM workspaces
WHERE id = @id
LIMIT 1;

-- name: ListWorkspaces :many
SELECT * FROM workspaces
ORDER BY created_at DESC;

-- name: UpdateWorkspace :one
UPDATE workspaces
SET
  name = COALESCE(@name, name),
  encrypted_name = COALESCE(@encrypted_name, encrypted_name),
  owner_id = COALESCE(@owner_id, owner_id)
WHERE id = @id
RETURNING *;

-- name: DeleteWorkspace :exec
DELETE FROM workspaces
WHERE id = @id;
