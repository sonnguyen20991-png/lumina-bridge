import React from 'react';
import { useSession } from '../components/Session';

export function Settings() {
  const session = useSession();

  const roleLabel = String(session.role || 'member')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

  const capabilities = [
    {
      icon: 'person_search',
      title: 'Target Builder',
      detail:
        'Natural-language targeting, interpreted filters and saved searches.',
    },
    {
      icon: 'hub',
      title: 'Contact Intelligence',
      detail:
        'Searchable client-scoped contact database with intelligence detail views.',
    },
    {
      icon: 'list_alt',
      title: 'Lead Lists & Exports',
      detail:
        'Saved prospect collections with CSV/XLSX export history.',
    },
    {
      icon: 'target',
      title: 'Campaign Operations',
      detail:
        'Campaign participants, progress tracking, notes and recorded history.',
    },
    {
      icon: 'upload',
      title: 'Import Operations',
      detail:
        'CSV/XLSX ingestion, background jobs, diagnostics, review and retries.',
    },
    {
      icon: 'rule',
      title: 'Conflict Review',
      detail:
        'Auditable shared-data conflict review with explicit reviewer decisions.',
    },
  ];

  const safeguards = [
    {
      icon: 'lock_person',
      title: 'Authenticated client scope',
      detail:
        'Workspace requests operate inside the authenticated client context.',
    },
    {
      icon: 'verified_user',
      title: 'Role-aware writes',
      detail:
        'Write actions remain permission-aware and unavailable to unsupported roles.',
    },
    {
      icon: 'fact_check',
      title: 'Evidence-first data',
      detail:
        'Counts shown by Lumina come from current workspace data; unsupported metrics are not fabricated.',
    },
    {
      icon: 'history',
      title: 'Operational history',
      detail:
        'Campaign progress, exports and import-review actions retain history where the backend supports it.',
    },
  ];

  return (
    <div className="lumina-admin space-y-7 pb-20">
      <section className="lumina-admin-hero">
        <div>
          <p className="lumina-admin-eyebrow">
            System &amp; Governance
          </p>

          <h1 className="lumina-admin-title">
            Workspace status and safeguards
          </h1>

          <p className="lumina-admin-subtitle">
            Authenticated session context, enabled workspace capabilities and
            operational safeguards for this Lumina environment.
          </p>
        </div>

        <a className="lumina-admin-verify" href="/app/">
          Reload &amp; verify session
        </a>
      </section>

      <section className="lumina-admin-session">
        <div className="lumina-admin-section-heading">
          <span className="material-symbols-outlined">
            verified
          </span>

          <div>
            <h2>Verified session</h2>
            <p>Current authenticated workspace context.</p>
          </div>
        </div>

        <div className="lumina-admin-session-grid">
          {[
            ['Identity', session.email, 'account_circle'],
            ['Client', session.client_name, 'domain'],
            ['Role', roleLabel, 'admin_panel_settings'],
            ['Authentication', session.provider, 'key'],
          ].map(([label, value, icon]) => (
            <article className="lumina-admin-session-item" key={label}>
              <span className="material-symbols-outlined">
                {icon}
              </span>

              <div>
                <small>{label}</small>
                <strong>{value || '—'}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lumina-admin-scope">
        <div>
          <p className="lumina-admin-section-label">
            Environment
          </p>
          <h2>Current workspace scope</h2>
        </div>

        <div className="lumina-admin-scope-grid">
          <div>
            <span>Environment</span>
            <strong>Staging</strong>
          </div>

          <div>
            <span>Client</span>
            <strong>{session.client_name || '—'}</strong>
          </div>

          <div>
            <span>Access role</span>
            <strong>{roleLabel}</strong>
          </div>

          <div>
            <span>Auth provider</span>
            <strong>{session.provider || '—'}</strong>
          </div>
        </div>
      </section>

      <section className="lumina-admin-capabilities">
        <div className="lumina-admin-block-heading">
          <p className="lumina-admin-section-label">
            Enabled now
          </p>

          <h2>Workspace capabilities</h2>

          <p>
            Capabilities currently exposed by this Lumina workspace.
          </p>
        </div>

        <div className="lumina-admin-capability-grid">
          {capabilities.map((item) => (
            <article
              className="lumina-admin-capability"
              key={item.title}
            >
              <span className="material-symbols-outlined">
                {item.icon}
              </span>

              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lumina-admin-safeguards">
        <div className="lumina-admin-block-heading">
          <p className="lumina-admin-section-label">
            Governance
          </p>

          <h2>Operational safeguards</h2>

          <p>
            Controls reflected by the current application behavior.
          </p>
        </div>

        <div className="lumina-admin-safeguard-grid">
          {safeguards.map((item) => (
            <article
              className="lumina-admin-safeguard"
              key={item.title}
            >
              <span className="material-symbols-outlined">
                {item.icon}
              </span>

              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lumina-admin-notice">
        <span className="material-symbols-outlined">
          science
        </span>

        <div>
          <strong>Staging environment</strong>

          <p>
            This service is running in the staging project and may contain QA
            records. Validate production-readiness separately before treating
            staging behavior as a production guarantee.
          </p>
        </div>
      </section>
    </div>
  );
}
