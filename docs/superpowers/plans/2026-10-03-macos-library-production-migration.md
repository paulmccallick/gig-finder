# macOS Library production migration

Issue: https://github.com/paulmccallick/gig-finder/issues/162

## Scope and acceptance

Keep the image and internal Linux paths. Default host bind mounts to the
current user's `~/Library/Application Support/GigFinder` and
`~/Library/Logs/GigFinder` directories, with existing absolute path overrides.
Preserve and validate the live database and artifacts, make a new verified
backup, and verify the cutover before retiring any old host path. Leave
inaccessible historical backups untouched.

## Cutover

1. Confirm the old container is stopped. Archive its Docker stdout log.
2. Create user-owned Library directories. Grant Codex writable access only to
   the two GigFinder Library directories in the user's local configuration.
3. Copy `/private/var/lib/gig-finder` into `Application Support/GigFinder/state`
   and `/private/etc/gig-finder/config.json` into the support root. Do not use a
   bootstrap command that would replace an existing database.
4. Compare source and target state, validate SQLite integrity and foreign keys,
   and make a verified backup under the new backup directory.
5. Deploy the approved immutable image with the updated script. Confirm exact
   revision, health, database validation, artifact access, and log creation.
6. Preserve the old state and protected historical backup directory until
   recovery needs are settled. Move the archived Docker log into Library Logs.

## Recovery

If validation fails before container replacement, leave the old container and
state untouched. If the new container fails, use the deployment script's
rollback and retain the verified backup. The old container cannot restart
against its vanished `/var/log` mount until that host path is restored; prefer
repairing the new paths and redeploying the same approved image.
