# Lumina Database Migrations

This directory is the canonical source for Lumina database migrations
from version 009 onward.

## Historical baseline

Migrations 001 through 008 were applied directly to the staging
PostgreSQL database before migration SQL files were retained in the
application repository.

Their applied versions and descriptions are recorded in the
`schema_migrations` table.

Do not recreate migrations 001 through 008 from memory or assumptions.

A schema-only baseline snapshot of the verified live database should
be captured separately before creating a fresh environment from
scratch.

## Current migration sequence

009 - Duplicate candidate score integrity for review-only fuzzy person matching

## Rules

- Every new schema change receives a new sequential migration.
- Applied migrations are never edited retroactively.
- Migrations should be safe to run exactly once.
- Application code must not depend on an unrecorded manual schema change.
- Production migrations must be tested in staging first.

010 - Product intelligence layer for saved targets, frozen lists, campaign history and tracked exports
