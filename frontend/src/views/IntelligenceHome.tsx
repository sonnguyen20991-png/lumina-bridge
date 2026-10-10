import React, { useEffect, useState } from 'react';
import { useSession } from '../components/Session';
import { gate1Api } from '../services/gate1Api';
import type {
  CampaignSummary,
  List,
  SavedTarget,
  View,
} from '../types';

interface IntelligenceHomeProps {
  onNavigate: (view: View) => void;
}

export function IntelligenceHome({ onNavigate }: IntelligenceHomeProps) {
  const session = useSession();

  const [lists, setLists] = useState<List[]>([]);
  const [targets, setTargets] = useState<SavedTarget[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function loadHome() {
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
      setCampaigns(Array.isArray(campaignResult.data) ? campaignResult.data : []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load workspace intelligence.',
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadHome();
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
    .slice(0, 3);

  const metrics = [
    {
      label: 'Lead Lists',
      value: lists.length,
      detail: 'Saved working lists',
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
      label: 'Build a Target',
      detail: 'Describe who you want to find',
      icon: 'person_search',
      view: 'builder',
    },
    {
      label: 'Explore Database',
      detail: 'Search contact intelligence',
      icon: 'hub',
      view: 'contacts',
    },
    {
      label: 'Open Lead Lists',
      detail: 'Review saved prospect groups',
      icon: 'list_alt',
      view: 'lists',
    },
    {
      label: 'Manage Campaigns',
      detail: 'Track campaign activity',
      icon: 'target',
      view: 'campaigns',
    },
  ];

  return (
    <div className="lumina-home space-y-7 animate-in pb-20">
      <section className="lumina-home-hero">
        <div>
          <p className="lumina-home-eyebrow">Intelligence Workspace</p>
          <h1 className="lumina-home-title">Good to see your workspace.</h1>
          <p className="lumina-home-subtitle">
            Live operational view for {session.client_name}.
          </p>
        </div>

        <button
          type="button"
          className="lumina-home-refresh"
          disabled={busy}
          onClick={() => {
            void loadHome();
          }}
        >
          {busy ? 'Refreshing…' : 'Refresh workspace'}
        </button>
      </section>

      {error && (
        <div role="alert" className="lumina-home-error">
          {error}
        </div>
      )}

      <section className="lumina-home-metrics">
        {metrics.map((metric) => (
          <article className="lumina-home-metric" key={metric.label}>
            <span className="material-symbols-outlined lumina-home-metric-icon">
              {metric.icon}
            </span>

            <p className="lumina-home-metric-label">{metric.label}</p>

            <strong className="lumina-home-metric-value">
              {busy ? '—' : metric.value}
            </strong>

            <p className="lumina-home-metric-detail">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="lumina-home-grid">
        <section className="lumina-home-actions">
          <div className="lumina-home-section-heading">
            <div>
              <h2>Start working</h2>
              <p>Jump into the workflows your team uses every day.</p>
            </div>
          </div>

          <div className="lumina-home-action-grid">
            {actions.map((action) => (
              <button
                type="button"
                className="lumina-home-action"
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

                <span className="material-symbols-outlined lumina-home-arrow">
                  arrow_forward
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="lumina-home-recent">
          <div className="lumina-home-section-heading">
            <div>
              <h2>Recent lead lists</h2>
              <p>Latest saved prospect collections.</p>
            </div>

            <button type="button" onClick={() => onNavigate('lists')}>
              View all
            </button>
          </div>

          {busy ? (
            <p className="lumina-home-muted">Loading workspace…</p>
          ) : recentLists.length ? (
            recentLists.map((list) => (
              <button
                type="button"
                className="lumina-home-recent-item"
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
            <p className="lumina-home-muted">No lead lists yet.</p>
          )}
        </section>
      </div>

      <section className="lumina-home-trust">
        <span className="material-symbols-outlined">verified_user</span>

        <div>
          <strong>Live workspace data</strong>
          <p>
            Counts above come from the current client workspace. List
            memberships are not presented as unique-contact totals.
          </p>
        </div>
      </section>
    </div>
  );
}
