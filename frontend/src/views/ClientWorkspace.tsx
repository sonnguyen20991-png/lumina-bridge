import React, { useEffect, useState } from 'react';
import { useSession } from '../components/Session';
import { gate1Api } from '../services/gate1Api';
import type {
  CampaignSummary,
  List,
  SavedTarget,
  View,
} from '../types';

interface ClientWorkspaceProps {
  onNavigate: (view: View) => void;
}

export function ClientWorkspace({ onNavigate }: ClientWorkspaceProps) {
  const session = useSession();

  const [lists, setLists] = useState<List[]>([]);
  const [targets, setTargets] = useState<SavedTarget[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function loadClientWorkspace() {
    setBusy(true);
    setError('');

    try {
      const [listResult, targetResult, campaignResult] = await Promise.all([
        gate1Api.getLists(),
        gate1Api.getSavedTargets(),
        gate1Api.getCampaigns(),
      ]);

      setLists(Array.isArray(listResult.data) ? listResult.data : []);
      setTargets(Array.isArray(targetResult.data) ? targetResult.data : []);
      setCampaigns(
        Array.isArray(campaignResult.data) ? campaignResult.data : [],
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load client workspace.',
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadClientWorkspace();
  }, []);

  const memberships = lists.reduce(
    (sum, list) =>
      sum + (Number.isSafeInteger(list.member_count) ? list.member_count : 0),
    0,
  );

  const recentLists = [...lists]
    .sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || '')),
    )
    .slice(0, 4);

  const roleLabel = String(session.role || 'member')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

  const metrics = [
    {
      label: 'Lead Lists',
      value: lists.length,
      detail: 'Saved prospect collections',
      icon: 'list_alt',
    },
    {
      label: 'List Memberships',
      value: memberships,
      detail: 'Memberships across saved lists',
      icon: 'group',
    },
    {
      label: 'Saved Searches',
      value: targets.length,
      detail: 'Reusable targeting recipes',
      icon: 'bookmark',
    },
    {
      label: 'Campaigns',
      value: campaigns.length,
      detail: 'Campaign workspaces',
      icon: 'target',
    },
  ];

  const actions: {
    label: string;
    detail: string;
    icon: string;
    view: View;
  }[] = [
    {
      label: 'Explore Database',
      detail: 'Search client contact intelligence',
      icon: 'hub',
      view: 'contacts',
    },
    {
      label: 'Build a Target',
      detail: 'Define the next prospect audience',
      icon: 'person_search',
      view: 'builder',
    },
    {
      label: 'Open Lead Lists',
      detail: 'Review saved prospect groups',
      icon: 'list_alt',
      view: 'lists',
    },
    {
      label: 'Campaign Operations',
      detail: 'Track campaign contact progress',
      icon: 'target',
      view: 'campaigns',
    },
    {
      label: 'Import Contacts',
      detail: 'Add or update client data',
      icon: 'upload',
      view: 'import',
    },
  ];

  return (
    <div className="lumina-client-workspace space-y-7 pb-20">
      <section className="lumina-client-hero">
        <div>
          <p className="lumina-client-eyebrow">Client Workspace</p>

          <h1 className="lumina-client-title">
            {session.client_name || 'Current client'}
          </h1>

          <p className="lumina-client-subtitle">
            Operational intelligence and activity scoped to this authenticated
            client.
          </p>
        </div>

        <button
          type="button"
          className="lumina-client-refresh"
          disabled={busy}
          onClick={() => {
            void loadClientWorkspace();
          }}
        >
          {busy ? 'Refreshing…' : 'Refresh workspace'}
        </button>
      </section>

      {error && (
        <div role="alert" className="lumina-client-error">
          {error}
        </div>
      )}

      <section className="lumina-client-profile">
        <div className="lumina-client-profile-main">
          <span className="material-symbols-outlined">domain</span>

          <div>
            <strong>{session.client_name || 'Current client'}</strong>
            <p>Authenticated workspace</p>
          </div>
        </div>

        <div className="lumina-client-profile-meta">
          <div>
            <span>Client ID</span>
            <code>{session.client_id || '—'}</code>
          </div>

          <div>
            <span>Your role</span>
            <strong>{roleLabel}</strong>
          </div>
        </div>
      </section>

      <section className="lumina-client-metrics">
        {metrics.map((metric) => (
          <article className="lumina-client-metric" key={metric.label}>
            <span className="material-symbols-outlined lumina-client-metric-icon">
              {metric.icon}
            </span>

            <p className="lumina-client-metric-label">{metric.label}</p>

            <strong className="lumina-client-metric-value">
              {busy ? '—' : metric.value}
            </strong>

            <p className="lumina-client-metric-detail">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="lumina-client-grid">
        <section className="lumina-client-actions">
          <div className="lumina-client-section-heading">
            <h2>Client operations</h2>
            <p>
              Open the workflows operating inside this client workspace.
            </p>
          </div>

          <div className="lumina-client-action-grid">
            {actions.map((action) => (
              <button
                type="button"
                className="lumina-client-action"
                onClick={() => onNavigate(action.view)}
                key={action.view}
              >
                <span className="material-symbols-outlined">
                  {action.icon}
                </span>

                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>

                <span className="material-symbols-outlined lumina-client-action-arrow">
                  arrow_forward
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="lumina-client-recent">
          <div className="lumina-client-section-heading">
            <h2>Recent lead lists</h2>
            <p>Latest prospect collections in this client.</p>
          </div>

          {busy ? (
            <p className="lumina-client-muted">Loading client activity…</p>
          ) : recentLists.length ? (
            recentLists.map((list) => (
              <button
                type="button"
                className="lumina-client-recent-item"
                onClick={() => onNavigate('lists')}
                key={list.id}
              >
                <span>
                  <strong>{list.name}</strong>
                  <small>
                    {Number.isSafeInteger(list.member_count)
                      ? list.member_count
                      : 0}{' '}
                    members
                  </small>
                </span>

                <span className="material-symbols-outlined">
                  chevron_right
                </span>
              </button>
            ))
          ) : (
            <p className="lumina-client-muted">No lead lists yet.</p>
          )}
        </section>
      </div>

      <section className="lumina-client-scope">
        <span className="material-symbols-outlined">lock_person</span>

        <div>
          <strong>Authenticated client scope</strong>
          <p>
            This page reports activity available to the current authenticated
            client. Lumina does not expose unsupported client-management
            controls here.
          </p>
        </div>
      </section>
    </div>
  );
}
