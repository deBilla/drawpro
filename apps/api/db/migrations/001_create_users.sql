CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email                TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    name                 TEXT,
    public_key           TEXT,
    encrypted_private_key TEXT,
    salt                 TEXT,
    recovery_codes_data  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
