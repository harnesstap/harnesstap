//! SQL copied verbatim from `src/db/schema.ts` by `tests/extract-sql.py`.
//! Each constant is named after the line where its template literal starts.

pub const L9: &str = r#"
    CREATE TABLE IF NOT EXISTS resources (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config',
        'plugin_pin','layer'
      )),
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      metadata    TEXT NOT NULL DEFAULT '{}',
      source      TEXT NOT NULL DEFAULT 'manual',
      namespace   TEXT NOT NULL DEFAULT '',
      origin_kind TEXT NOT NULL DEFAULT 'manual'
        CHECK(origin_kind IN ('local_snapshot','marketplace_link','manual')),
      origin_ref  TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      content_blob_ref TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
      ON resources(type, name, namespace);

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      org_slug TEXT NOT NULL DEFAULT '',
      catalog_slug TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      claude_config TEXT NOT NULL DEFAULT '{}',
      needs_config TEXT NOT NULL DEFAULT '[]',
      default_environment_id TEXT REFERENCES environments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(org_slug, catalog_slug, name, version)
    );

    CREATE TABLE IF NOT EXISTS layer_resources (
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS layer_publish_targets (
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      org_slug TEXT NOT NULL,
      catalog_slug TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (layer_id, org_slug, catalog_slug)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      git_origin  TEXT NOT NULL DEFAULT '',
      local_id    TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL DEFAULT '',
      local_path  TEXT NOT NULL DEFAULT '',
      tracked_at  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      CHECK (git_origin != '' OR local_id != '')
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_git_origin
      ON projects(git_origin) WHERE git_origin != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_local_id
      ON projects(local_id) WHERE local_id != '';

    CREATE TABLE IF NOT EXISTS project_layers (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      platforms TEXT NOT NULL DEFAULT '[]',
      applied_at TEXT NOT NULL,
      PRIMARY KEY (project_id, layer_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project
      ON snapshots(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS harness_preferences (
      scope            TEXT PRIMARY KEY DEFAULT 'default',
      main_harness     TEXT NOT NULL,
      alias_harnesses  TEXT NOT NULL DEFAULT '[]',
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_harnesses (
      project_id              TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      main_harness            TEXT NOT NULL,
      alias_harnesses         TEXT NOT NULL DEFAULT '[]',
      materialization_strategy TEXT NOT NULL DEFAULT 'symlink-preferred',
      updated_at              TEXT NOT NULL,
      cursor_skill_mode       TEXT
    );

    CREATE TABLE IF NOT EXISTS environment_resources (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (environment_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS environment_secret_refs (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('keychain','env','file')),
      ref TEXT NOT NULL,
      PRIMARY KEY (environment_id, key)
    );

    CREATE TABLE IF NOT EXISTS imported_snapshots (
      id              TEXT PRIMARY KEY,
      source_kind     TEXT NOT NULL CHECK(source_kind IN (
        'cursor-plugin', 'claude-plugin', 'codex-plugin', 'copilot-plugin',
        'marketplace', 'skill-package'
      )),
      source_label    TEXT NOT NULL,
      plugin_name     TEXT NOT NULL,
      plugin_version  TEXT,
      resource_ids    TEXT NOT NULL DEFAULT '[]',
      metadata        TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_imported_snapshots_created_at
      ON imported_snapshots(created_at DESC);

    CREATE TABLE IF NOT EXISTS imported_snapshot_installs (
      snapshot_id    TEXT NOT NULL REFERENCES imported_snapshots(id) ON DELETE CASCADE,
      platform_id    TEXT NOT NULL,
      files          TEXT NOT NULL DEFAULT '[]',
      installed_at   TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, platform_id)
    );

    CREATE INDEX IF NOT EXISTS idx_imported_snapshot_installs_installed_at
      ON imported_snapshot_installs(installed_at DESC);

    CREATE TABLE IF NOT EXISTS global_apply_snapshots (
      id           TEXT PRIMARY KEY,
      profile_name TEXT NOT NULL,
      layer_ids    TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_apply_snapshot_installs (
      snapshot_id  TEXT NOT NULL REFERENCES global_apply_snapshots(id) ON DELETE CASCADE,
      platform_id  TEXT NOT NULL,
      files        TEXT NOT NULL DEFAULT '[]',
      installed_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, platform_id)
    );

    CREATE INDEX IF NOT EXISTS idx_global_apply_snapshots_created_at
      ON global_apply_snapshots(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_global_apply_snapshot_installs_installed_at
      ON global_apply_snapshot_installs(installed_at DESC);

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (22);
  "#;

pub const L198: &str = r#"
    ALTER TABLE layers ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE layers ADD COLUMN frozen_at TEXT;
    CREATE TABLE IF NOT EXISTS layer_working_snapshots (
      layer_id TEXT PRIMARY KEY REFERENCES layers(id) ON DELETE CASCADE,
      source_version TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  "#;

pub const L208: &str = r#"
    ALTER TABLE layers ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE global_apply_snapshots ADD COLUMN resolved_set TEXT NOT NULL DEFAULT '[]';
  "#;

pub const L212: &str = r#"
    ALTER TABLE layers ADD COLUMN origin TEXT NOT NULL DEFAULT 'authored'
      CHECK(origin IN ('authored','upstream','catalog'));
    UPDATE layers SET origin = 'catalog'
      WHERE org_slug != '' AND catalog_slug != '';
  "#;

pub const L220: &str = r#"
    ALTER TABLE plugins ADD COLUMN ap_name TEXT NOT NULL DEFAULT '';
  "#;

pub const L223: &str = r#"
    ALTER TABLE plugins ADD COLUMN origin_locator TEXT NOT NULL DEFAULT '';
    ALTER TABLE plugins ADD COLUMN origin_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE plugins ADD COLUMN origin_fingerprint_kind TEXT NOT NULL DEFAULT ''
      CHECK(origin_fingerprint_kind IN ('', 'git_sha', 'catalog_digest', 'catalog_version'));
  "#;

pub const L229: &str = r#"
    CREATE TABLE resource_materializations (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      root_path TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      path TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('delete-file', 'delete-directory', 'edit-file')),
      ownership_key TEXT NOT NULL,
      generated_hash TEXT NOT NULL,
      managed_container INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(resource_id, scope, project_id, root_path, platform_id, path, ownership_key)
    );

    CREATE INDEX idx_resource_materializations_path
      ON resource_materializations(root_path, path);
    CREATE INDEX idx_resource_materializations_resource
      ON resource_materializations(resource_id);
  "#;

pub const L252: &str = r#"
    CREATE TABLE package_cache_entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('host_plugin', 'apm_git')),
      resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
      origin_ref TEXT NOT NULL,
      resolved_key TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_fingerprint TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(kind, origin_ref, resolved_key)
    );

    CREATE INDEX idx_package_cache_entries_origin
      ON package_cache_entries(origin_ref, resolved_key);

    CREATE TABLE plugin_pin_materializations (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
      root_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      origin_ref TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      plugin_pin_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, root_path, relative_path)
    );

    CREATE INDEX idx_plugin_pin_materializations_lookup
      ON plugin_pin_materializations(scope, root_path, relative_path);
  "#;

pub const L288: &str = r#"
    CREATE TABLE IF NOT EXISTS preexisting_paths (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(root_path, path)
    );

    CREATE INDEX IF NOT EXISTS idx_preexisting_paths_root
      ON preexisting_paths(root_path, path);

    CREATE TABLE IF NOT EXISTS apply_removal_backups (
      id TEXT PRIMARY KEY,
      apply_id TEXT NOT NULL,
      snapshot_id TEXT,
      relative_path TEXT NOT NULL,
      content BLOB NOT NULL,
      mode INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_apply_removal_backups_apply
      ON apply_removal_backups(apply_id);
    CREATE INDEX IF NOT EXISTS idx_apply_removal_backups_snapshot
      ON apply_removal_backups(snapshot_id);
  "#;

pub const L320: &str = r#"
    CREATE TABLE IF NOT EXISTS plugin_data_dirs (
      plugin_name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  "#;

pub const L330: &str = r#"
    CREATE TABLE IF NOT EXISTS plugin_install_files (
      plugin_name TEXT NOT NULL,
      plugin_version TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      PRIMARY KEY (plugin_name, plugin_version, relative_path)
    );
  "#;

pub const L359: &str = r#"
    CREATE TABLE IF NOT EXISTS upstream_checks (
      plugin_name TEXT NOT NULL,
      ref TEXT NOT NULL,
      local_version TEXT NOT NULL,
      latest_in_range TEXT NOT NULL DEFAULT '',
      latest_major TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('current', 'update', 'major', 'unreachable', 'unpublished')),
      checked_at TEXT NOT NULL,
      dismissed_version TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (plugin_name, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_upstream_checks_status ON upstream_checks(status);
  "#;

pub const L389: &str = r#"
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      plugin_name TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_read_created ON notifications(read_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
      ON notifications(kind, plugin_name, json_extract(payload, '$.version'));
  "#;

pub const L410: &str = r#"
    CREATE TABLE IF NOT EXISTS plugin_excludes (
      plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      entry TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, entry)
    );
  "#;

pub const L454: &str = r#"
    CREATE TABLE IF NOT EXISTS plugin_opaque_files (
      plugin_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      encoding TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (plugin_id, relative_path)
    );
  "#;

pub const L529: &str = r#"
        CREATE TABLE harness_preferences_new (
          scope TEXT PRIMARY KEY DEFAULT 'default',
          registered_harnesses TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        );
      "#;

pub const L546: &str = r#"INSERT INTO harness_preferences_new (scope, registered_harnesses, updated_at)
         VALUES (?, ?, ?)"#;

pub const L555: &str = r#"
        DROP TABLE harness_preferences;
        ALTER TABLE harness_preferences_new RENAME TO harness_preferences;
      "#;

pub const L565: &str = r#"
        CREATE TABLE project_harnesses_new (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          registered_harnesses TEXT NOT NULL DEFAULT '[]',
          materialization_strategy TEXT NOT NULL DEFAULT 'symlink-preferred',
          updated_at TEXT NOT NULL,
          cursor_skill_mode TEXT
        );
      "#;

pub const L586: &str = r#"INSERT INTO project_harnesses_new (
           project_id, registered_harnesses, materialization_strategy,
           cursor_skill_mode, updated_at
         ) VALUES (?, ?, ?, ?, ?)"#;

pub const L603: &str = r#"
        DROP TABLE project_harnesses;
        ALTER TABLE project_harnesses_new RENAME TO project_harnesses;
      "#;

pub const L646: &str = r#"
      CREATE TABLE plugin_resources (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (plugin_id, resource_id)
      );
      INSERT INTO plugin_resources (plugin_id, resource_id, "order")
        SELECT layer_id, resource_id, "order" FROM layer_resources;
      DROP TABLE layer_resources;
    "#;

pub const L660: &str = r#"
      CREATE TABLE plugin_working_snapshots (
        plugin_id TEXT PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
        source_version TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO plugin_working_snapshots (plugin_id, source_version, payload, created_at)
        SELECT layer_id, source_version, payload, created_at FROM layer_working_snapshots;
      DROP TABLE layer_working_snapshots;
    "#;

pub const L674: &str = r#"
      CREATE TABLE plugin_publish_targets (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        org_slug TEXT NOT NULL,
        catalog_slug TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, org_slug, catalog_slug)
      );
      INSERT INTO plugin_publish_targets (plugin_id, org_slug, catalog_slug, created_at)
        SELECT layer_id, org_slug, catalog_slug, created_at FROM layer_publish_targets;
      DROP TABLE layer_publish_targets;
    "#;

pub const L689: &str = r#"
      CREATE TABLE project_plugins (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        platforms TEXT NOT NULL DEFAULT '[]',
        applied_at TEXT NOT NULL,
        PRIMARY KEY (project_id, plugin_id)
      );
      INSERT INTO project_plugins (project_id, plugin_id, platforms, applied_at)
        SELECT project_id, layer_id, platforms, applied_at FROM project_layers;
      DROP TABLE project_layers;
    "#;

pub const L732: &str = r#"
      DELETE FROM layer_resources
      WHERE resource_id IN (
        SELECT l.id FROM resources l
        INNER JOIN resources p
          ON p.type = 'plugin_pin' AND l.type = 'layer'
         AND p.name = l.name AND p.namespace = l.namespace
      )
      AND EXISTS (
        SELECT 1
        FROM layer_resources lr_pin
        INNER JOIN resources p ON p.id = lr_pin.resource_id AND p.type = 'plugin_pin'
        INNER JOIN resources l ON l.id = layer_resources.resource_id AND l.type = 'layer'
        WHERE lr_pin.layer_id = layer_resources.layer_id
          AND p.name = l.name
          AND p.namespace = l.namespace
      );
    "#;

pub const L751: &str = r#"
      UPDATE layer_resources
      SET resource_id = (
        SELECT p.id FROM resources p
        INNER JOIN resources l ON l.id = layer_resources.resource_id
        WHERE p.type = 'plugin_pin' AND l.type = 'layer'
          AND p.name = l.name AND p.namespace = l.namespace
      )
      WHERE resource_id IN (
        SELECT l.id FROM resources l
        INNER JOIN resources p
          ON p.type = 'plugin_pin' AND l.type = 'layer'
         AND p.name = l.name AND p.namespace = l.namespace
      );
    "#;

pub const L768: &str = r#"
    DELETE FROM resources
    WHERE type = 'layer'
      AND EXISTS (
        SELECT 1 FROM resources p
        WHERE p.type = 'plugin_pin'
          AND p.name = resources.name
          AND p.namespace = resources.namespace
      );
  "#;

pub const L779: &str = r#"
    CREATE TABLE resources_new (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config','plugin'
      )),
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      metadata    TEXT NOT NULL DEFAULT '{}',
      source      TEXT NOT NULL DEFAULT 'manual',
      namespace   TEXT NOT NULL DEFAULT '',
      origin_kind TEXT NOT NULL DEFAULT 'manual'
        CHECK(origin_kind IN ('local_snapshot','marketplace_link','manual')),
      origin_ref  TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      content_blob_ref TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    INSERT INTO resources_new
      SELECT
        id,
        CASE WHEN type IN ('plugin_pin','layer') THEN 'plugin' ELSE type END,
        name,
        description,
        content,
        CASE
          WHEN type = 'plugin_pin' THEN json_set(
            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
            '$.source_kind',
            COALESCE(json_extract(metadata, '$.source_kind'), 'marketplace')
          )
          WHEN type = 'layer' THEN json_set(
            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
            '$.source_kind', 'local'
          )
          ELSE metadata
        END,
        CASE WHEN type IN ('plugin_pin','layer') THEN 'composition:plugin' ELSE source END,
        namespace,
        origin_kind,
        CASE WHEN type = 'layer' AND origin_ref = '' THEN name ELSE origin_ref END,
        content_hash,
        content_blob_ref,
        created_at,
        updated_at
      FROM resources;

    DROP TABLE resources;
    ALTER TABLE resources_new RENAME TO resources;

    CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
      ON resources(type, name, namespace);
  "#;
