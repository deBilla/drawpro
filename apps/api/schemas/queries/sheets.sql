-- name: CreateSheet :one
INSERT INTO sheets (
  workspace_id,
  name,
  elements,
  app_state,
  encrypted_data
) VALUES (
  @workspace_id,
  @name,
  @elements,
  @app_state,
  @encrypted_data
)
RETURNING *;

-- name: GetSheetByID :one
SELECT * FROM sheets
WHERE id = @id
LIMIT 1;

-- name: ListSheets :many
SELECT * FROM sheets
ORDER BY created_at DESC;

-- name: UpdateSheet :one
UPDATE sheets
SET
  workspace_id = COALESCE(@workspace_id, workspace_id),
  name = COALESCE(@name, name),
  elements = COALESCE(@elements, elements),
  app_state = COALESCE(@app_state, app_state),
  encrypted_data = COALESCE(@encrypted_data, encrypted_data)
WHERE id = @id
RETURNING *;

-- name: DeleteSheet :exec
DELETE FROM sheets
WHERE id = @id;
