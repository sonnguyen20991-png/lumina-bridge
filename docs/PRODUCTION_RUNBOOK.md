# Lumina Production Runbook

Last verified: 2026-10-08

This document describes the verified operational, recovery, deployment, IAM, database, and source-control procedures for Lumina.

Do not store passwords, API keys, database passwords, OAuth secrets, service-account keys, or other credentials in this repository.

---

# 1. Environment

## Google Cloud

Project ID: lumina-staging-509411

Project number: 710741493676

Primary region: asia-southeast1

Primary operator Google account: son.nguyen20991@gmail.com

Former account: sonnynguyenofficial@gmail.com

The former account must not have active Lumina client membership or project IAM access.

---

# 2. Cloud Run

Service: lumina-bridge

IAP-facing URL:
https://lumina-bridge-cbzmo4izjq-as.a.run.app

Application:
https://lumina-bridge-cbzmo4izjq-as.a.run.app/app/

Canonical Cloud Run URL:
https://lumina-bridge-710741493676.asia-southeast1.run.app

Known-good migration revision as of 2026-10-08:
lumina-bridge-00080-cdb

---

# 3. Cloud SQL

Instance: lumina-pg-staging

Database: lumina

Database engine: PostgreSQL 18

Region: asia-southeast1

Verified configuration as of 2026-10-08:

- Edition: ENTERPRISE
- Tier: db-custom-4-16384
- Disk: 100 GB PD_SSD
- Availability: ZONAL
- Deletion protection: ENABLED
- Automated backups: ENABLED
- Retained backups: 7
- Point-in-time recovery: ENABLED
- Transaction log retention: 7 days
- Backup location: asia

---

# 4. Cloud SQL Backups

Automated backups are enabled with 7 retained backups.
Point-in-time recovery is enabled with 7-day transaction-log retention.

List recent backups:

    gcloud sql backups list --instance=lumina-pg-staging --project=lumina-staging-509411 --limit=10

Create a manual recovery checkpoint:

    gcloud sql backups create --instance=lumina-pg-staging --project=lumina-staging-509411 --description="Lumina manual recovery checkpoint"

Expected successful status: SUCCESSFUL

Recovery checkpoint verified on 2026-10-08: backup ID 1791433867415.
Do not depend permanently on this ID because retention may eventually remove it.

---

# 5. Cloud SQL Restore Drill

Never test a restore directly against lumina-pg-staging.
Use a separate disposable instance.

Example temporary instance:

    lumina-pg-restore-drill

Create a compatible PostgreSQL 18 restore target:

    gcloud sql instances create lumina-pg-restore-drill --project=lumina-staging-509411 --database-version=POSTGRES_18 --region=asia-southeast1 --edition=ENTERPRISE --cpu=2 --memory=7680MiB --storage-type=SSD --storage-size=100GB --availability-type=zonal --no-deletion-protection

Restore a backup into the disposable instance:

    gcloud sql backups restore BACKUP_ID --backup-instance=lumina-pg-staging --restore-instance=lumina-pg-restore-drill --project=lumina-staging-509411

Confirm the restore operation:

    gcloud sql operations list --instance=lumina-pg-restore-drill --project=lumina-staging-509411 --limit=5

Expected restore result:

    TYPE: RESTORE_VOLUME
    STATUS: DONE
    ERROR: -

List restored databases:

    gcloud sql databases list --instance=lumina-pg-restore-drill --project=lumina-staging-509411

Expected application database: lumina

Connect to the restored instance:

    gcloud sql connect lumina-pg-restore-drill --user=postgres --project=lumina-staging-509411

Inside psql:

    \c lumina

Check schema:

    \dt public.*

Check migrations:

    SELECT version, description FROM public.schema_migrations ORDER BY version;

Verified on 2026-10-08: migrations 001 through 014 were present.

Check critical tables:

    SELECT to_regclass('public.import_jobs') AS import_jobs, to_regclass('public.saved_targets') AS saved_targets, to_regclass('public.clients') AS clients, to_regclass('public.app_principals') AS app_principals, to_regclass('public.client_memberships') AS client_memberships;

Verified restore counts on 2026-10-08:

    clients: 2
    principals: 4
    memberships: 4
    persons: 11530
    companies: 1857
    import_jobs: 101
    saved_targets: 4

These counts are historical reference values only and will change as production data changes.

Exit psql:

    \q

Delete the disposable restore instance immediately after verification:

    gcloud sql instances delete lumina-pg-restore-drill --project=lumina-staging-509411

---

# 6. Cloud SQL Service Agent

Cloud SQL service agent:

    service-710741493676@gcp-sa-cloud-sql.iam.gserviceaccount.com

Required project role:

    roles/cloudsql.serviceAgent

Verify:

    gcloud projects get-iam-policy lumina-staging-509411 --flatten="bindings[].members" --filter="bindings.members:service-710741493676@gcp-sa-cloud-sql.iam.gserviceaccount.com" --format="table(bindings.role,bindings.members)"

If the service identity is missing:

    gcloud beta services identity create --service=sqladmin.googleapis.com --project=lumina-staging-509411

If necessary, restore the standard binding:

    gcloud projects add-iam-policy-binding lumina-staging-509411 --member="serviceAccount:service-710741493676@gcp-sa-cloud-sql.iam.gserviceaccount.com" --role="roles/cloudsql.serviceAgent"

Do not assign unrelated roles to the Cloud SQL service agent.

---

# 7. Cloud Tasks

Queue: lumina-imports

Check:

    gcloud tasks queues describe lumina-imports --location=asia-southeast1 --project=lumina-staging-509411

Expected state: RUNNING

---

# 8. Runtime Service Account

Cloud Run runtime service account:

    lumina-bridge@lumina-staging-509411.iam.gserviceaccount.com

Do not replace or broaden its permissions without reviewing the application requirements first.

---

# 9. IAP and Lumina Authorization

Current bootstrap identity:

    son.nguyen20991@gmail.com

Current shared-data reviewer principal:

    3fcc14ef-ddcb-40e3-9ae2-f3433d6e3bce

Verified active principal:

    ID: 3fcc14ef-ddcb-40e3-9ae2-f3433d6e3bce
    Provider: iap
    Email: son.nguyen20991@gmail.com
    Status: active
    Role: owner

Former principal:

    ID: d6adcdbb-df25-4457-870f-5c093baf8771
    Email: sonnynguyenofficial@gmail.com
    Status: disabled

Former membership:

    ec41dab3-50e2-4e8a-9b7e-7661562a03be

The former principal and membership are retained for historical and audit integrity but disabled.

Verified old-account denial on 2026-10-08:

    Your account has no active client membership.

---

# 10. GitHub Repository

Private repository:

    https://github.com/sonnguyen20991-png/lumina-bridge

Remote: origin
Primary branch: main

Check:

    git remote -v
    git branch --show-current
    git status --short

The working tree should normally be clean before deployment.

---

# 11. Production Recovery Tag

Known-good source baseline:

    production-baseline-2026-10-08

Underlying commit:

    617f5f24927a180f70aa4569706726cef1466dcd

Verify:

    git show --no-patch --decorate production-baseline-2026-10-08
    git ls-remote --tags origin

The recovery tag must not be moved or rewritten.

---

# 12. GitHub CI

Workflow:

    .github/workflows/ci.yml

CI introduced in commit:

    cdbb5ff

The workflow validates:

- npm dependency installation
- Lumina Node tests
- runtime JavaScript syntax
- required frontend build files

Verified local baseline:

    17 tests
    17 pass
    0 fail

---

# 13. Main Branch Policy

A ruleset named main is configured for the default branch.

Intended controls include:

- pull request before merge
- conversation resolution
- linear history
- block force pushes
- restrict deletions

GitHub displayed a warning that enforcement on this private repository requires a GitHub Team organization account.
Therefore do not treat the ruleset as a hard enforcement boundary under the current plan.

---

# 14. Safe Change Procedure

Before modifying production code:

    cd ~/lumina-bridge
    git status --short
    git pull --ff-only origin main

Create a working branch:

    git switch -c change/SHORT-DESCRIPTION

Before commit:

    git diff --check
    node --test tests/*.test.mjs
    git diff
    git status --short

Commit only intended files.
Push the branch and use a pull request whenever practical.
Do not force-push main.

---

# 15. Deployment Safety Procedure

Before deployment:

1. Confirm Git working tree is clean.
2. Confirm CI passes.
3. Confirm current Cloud Run revision.
4. Confirm Cloud SQL is RUNNABLE.
5. Confirm Cloud Tasks is RUNNING.
6. Create an on-demand DB backup before high-risk schema changes.
7. Record the Git commit being deployed.
8. Deploy using the approved Cloud Run procedure.
9. Verify the new Cloud Run revision.
10. Run application smoke tests.
11. Keep the prior revision available until validation completes.

Do not invent or change runtime environment variables during deployment.

---

# 16. Rollback Strategy

Application rollback:

    gcloud run revisions list --service=lumina-bridge --region=asia-southeast1 --project=lumina-staging-509411

Source recovery anchor:

    production-baseline-2026-10-08

Do not reset production blindly. Determine whether application rollback, database rollback, or both are required.

Database rollback:

Prefer point-in-time recovery or restore into a separate instance first.
Never restore over production merely to test a backup.

---

# 17. Schema Migration Discipline

Migration directory: migrations/
Current verified latest migration: 014_saved_target_name_uniqueness.sql
Current verified schema version: 014

Rules:

- never edit an already-applied migration to rewrite history
- create a new numbered migration
- test migrations safely before production
- verify schema_migrations after deployment

---

# 18. Incident Checklist

If Lumina becomes unavailable:

1. Check Cloud Run status.
2. Check latest ready revision.
3. Check Cloud SQL state.
4. Check Cloud Tasks queue.
5. Check recent Cloud Run logs.
6. Check database connectivity.
7. Check IAP identity and Lumina membership.
8. Check recent deployments and Git commits.
9. Avoid destructive actions until the fault domain is identified.
10. Create a DB backup before invasive repair if the database is healthy.

---

# 19. Security Rules

Never commit passwords, API keys, OAuth secrets, database passwords, private keys, service-account key files, access tokens, or session cookies.
Prefer IAM and service identities over downloadable service-account keys.

---

# 20. Verified Recovery Milestones

- Google-account migration completed
- former project IAM access removed
- former Lumina principal and membership disabled
- old-account denial verified
- private GitHub repository established
- production baseline committed and tagged
- CI workflow created
- local tests passed 17/17
- automated backups and PITR verified
- manual recovery backup created
- Cloud SQL service agent repaired
- independent restore drill completed successfully
- restored schema and data verified
- temporary restore instance deleted

---

# 21. Recovery Anchors

Source recovery:

    Git tag: production-baseline-2026-10-08
    Commit: 617f5f24927a180f70aa4569706726cef1466dcd

CI introduction:

    Commit: cdbb5ff

Database recovery:

Use the newest successful Cloud SQL backup or point-in-time recovery target available at incident time.
Do not depend permanently on a historical backup ID.

Operational principle:

    SOURCE -> TEST -> BACKUP -> DEPLOY -> VERIFY -> OBSERVE

Recovery principle:

    IDENTIFY -> PRESERVE -> RESTORE SAFELY -> VERIFY -> CUT OVER
