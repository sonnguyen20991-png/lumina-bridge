import React, { useEffect, useState } from 'react';
import { canWrite, useSession } from '../components/Session';
import { ApiError, gate1Api } from '../services/gate1Api';
import type {
  CampaignEvent,
  CampaignHistoryRecord,
  CampaignParticipant,
  CampaignSummary,
  List,
} from '../types';

const button =
  'px-4 py-2 rounded-lg border border-[#3f3f46] disabled:opacity-40';

const field =
  'w-full p-3 rounded-lg bg-[#18181b] border border-[#3f3f46]';

function toLocalDateTime(value?: string | null) {
  if (!value) return '';

  const date = new Date(value);

  return new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
}

export function Campaigns() {
  const session = useSession();
  const writable = canWrite(session.role);

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [lists, setLists] = useState<List[]>([]);

  const [campaignId, setCampaignId] = useState('');
  const [listId, setListId] = useState('');

  const [campaignName, setCampaignName] = useState('');
  const [newCampaignId, setNewCampaignId] = useState(
    () => crypto.randomUUID(),
  );

  const [participants, setParticipants] = useState<CampaignParticipant[]>([]);
  const [offset, setOffset] = useState(0);

  const [editor, setEditor] = useState<CampaignParticipant | null>(null);

  const [history, setHistory] = useState<CampaignHistoryRecord[]>([]);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [historyName, setHistoryName] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uncertainWrite, setUncertainWrite] = useState(false);

  async function loadWorkspace() {
    const [campaignResult, listResult] = await Promise.all([
      gate1Api.getCampaigns(),
      gate1Api.getLists(),
    ]);

    setCampaigns(campaignResult.data);
    setLists(listResult.data);
  }

  async function loadParticipants(id: string, nextOffset: number) {
    const result = await gate1Api.getCampaignParticipants(id, nextOffset);
    setParticipants(result.data);
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');

    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');

      if (err instanceof ApiError && err.uncertainWrite) {
        setUncertainWrite(true);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(loadWorkspace);
  }, []);

  const locked = busy || uncertainWrite;

  async function refreshAndInspect(clearUncertain = false) {
    await loadWorkspace();

    if (campaignId) {
      await loadParticipants(campaignId, offset);
    }

    setEditor(null);

    if (clearUncertain) {
      setUncertainWrite(false);
    }
  }

  return (
    <div className="lumina-campaigns space-y-6">
      <h1 className="lumina-campaigns-title text-2xl text-white font-bold">
        Campaigns
      </h1>

      <p className="lumina-campaigns-subtitle">
        Track list usage, contact progress and previous updates within this
        client. Adding contacts does not send outreach.
      </p>

      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}

      {status && (
        <p role="status" className="text-emerald-300">
          {status}
        </p>
      )}

      {uncertainWrite && (
        <p>
          The change may have saved. Refresh and inspect the campaign before
          making another change.{' '}
          <button
            className={button}
            onClick={() => {
              void run(() => refreshAndInspect(true));
            }}
          >
            Refresh and inspect
          </button>
        </p>
      )}

      <button
        className={`lumina-campaign-refresh ${button}`}
        disabled={busy}
        onClick={() => {
          void run(() => refreshAndInspect());
        }}
      >
        Refresh
      </button>

      {writable && (
        <form
          className="lumina-campaign-create flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();

            void run(async () => {
              const result = await gate1Api.createCampaign({
                id: newCampaignId,
                name: campaignName,
              });

              setCampaignId(result.data.id);
              setOffset(0);
              setParticipants([]);
              setCampaignName('');
              setNewCampaignId(crypto.randomUUID());

              await loadWorkspace();

              setStatus('Campaign created. Choose a lead list below.');
            });
          }}
        >
          <input
            aria-label="Campaign name"
            placeholder="Campaign name"
            required
            maxLength={300}
            value={campaignName}
            disabled={locked}
            onChange={(event) => setCampaignName(event.target.value)}
            className={`lumina-campaign-name ${field}`}
          />

          <button
            className={`lumina-campaign-create-button ${button}`}
            disabled={locked || !campaignName.trim()}
          >
            Create campaign
          </button>
        </form>
      )}

      <label className="lumina-campaign-selector block">
        Campaign

        <select
          className={`lumina-campaign-select ${field}`}
          disabled={busy}
          value={campaignId}
          onChange={(event) => {
            const id = event.target.value;

            setCampaignId(id);
            setOffset(0);
            setEditor(null);
            setHistoryName('');
            setParticipants([]);

            if (id) {
              void run(() => loadParticipants(id, 0));
            }
          }}
        >
          <option value="">Choose a campaign</option>

          {campaigns.map((campaign) => (
            <option value={campaign.id} key={campaign.id}>
              {campaign.name} · {campaign.participant_count} contacts
            </option>
          ))}
        </select>
      </label>

      {campaignId && writable && (
        <div className="lumina-campaign-import flex gap-3">
          <select
            aria-label="Lead list"
            className={`lumina-campaign-list-select ${field}`}
            value={listId}
            disabled={locked}
            onChange={(event) => setListId(event.target.value)}
          >
            <option value="">Choose a lead list</option>

            {lists.map((list) => (
              <option value={list.id} key={list.id}>
                {list.name} · {list.member_count} members
              </option>
            ))}
          </select>

          <button
            className={`lumina-campaign-import-button ${button}`}
            disabled={locked || !listId}
            onClick={() => {
              void run(async () => {
                const result = await gate1Api.importListToCampaign(
                  campaignId,
                  listId,
                );

                await loadWorkspace();
                await loadParticipants(campaignId, offset);

                setStatus(
                  `${result.data.added} contacts added. Existing progress was preserved.`,
                );
              });
            }}
          >
            Add list to campaign
          </button>
        </div>
      )}

      {campaignId && (
        <>
          <table className="lumina-campaign-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Note</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {participants.map((participant) => (
                <tr
                  className="lumina-campaign-row border-t border-[#27272a]"
                  key={participant.person_id}
                >
                  <td className="py-4">
                    {participant.full_name}

                    <span className="block text-[#a1a1aa]">
                      {participant.current_title} · {participant.contact_country}
                    </span>
                  </td>

                  <td>{participant.stage || '—'}</td>
                  <td>{participant.status || '—'}</td>

                  <td className="max-w-xs whitespace-pre-wrap">
                    {participant.note || '—'}
                  </td>

                  <td>
                    {writable && (
                      <button
                        className={button}
                        disabled={locked}
                        onClick={() => {
                          setHistoryName('');
                          setEditor({
                            ...participant,
                            stage: participant.stage || 'not_started',
                            status: participant.status || 'active',
                            note: participant.note || '',
                          });
                        }}
                      >
                        Edit progress
                      </button>
                    )}

                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        setEditor(null);

                        void run(async () => {
                          const result =
                            await gate1Api.getCampaignHistory(
                              participant.person_id,
                            );

                          setHistory(result.data);
                          setEvents(result.events || []);
                          setHistoryName(participant.full_name);
                        });
                      }}
                    >
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!participants.length && <p>No participants on this page.</p>}

          <div className="lumina-campaign-pagination flex gap-4">
            <button
              className={button}
              disabled={busy || offset === 0}
              onClick={() => {
                void run(async () => {
                  const nextOffset = offset - 50;

                  await loadParticipants(campaignId, nextOffset);
                  setOffset(nextOffset);
                  setEditor(null);
                });
              }}
            >
              Previous
            </button>

            <span>Page {offset / 50 + 1}</span>

            <button
              className={button}
              disabled={busy || participants.length < 50}
              onClick={() => {
                void run(async () => {
                  const nextOffset = offset + 50;

                  await loadParticipants(campaignId, nextOffset);
                  setOffset(nextOffset);
                  setEditor(null);
                });
              }}
            >
              Next
            </button>
          </div>
        </>
      )}

      {editor && (
        <form
          className="lumina-campaign-editor p-6 border border-[#3f3f46] rounded-xl space-y-4"
          onSubmit={(event) => {
            event.preventDefault();

            void run(async () => {
              await gate1Api.updateCampaignParticipant(
                campaignId,
                editor.person_id,
                {
                  stage: editor.stage || 'not_started',
                  status: editor.status || 'active',
                  note: editor.note || '',
                  first_contacted_at: editor.first_contacted_at,
                  last_contacted_at: editor.last_contacted_at,
                  expected_updated_at: editor.version,
                },
              );

              setEditor(null);
              setHistoryName('');

              await loadParticipants(campaignId, offset);
              await loadWorkspace();

              setStatus(
                'Progress saved with its previous values in history.',
              );
            });
          }}
        >
          <h2>Edit {editor.full_name}</h2>

          <label className="block">
            Stage

            <select
              className={field}
              value={editor.stage || 'not_started'}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  stage: event.target.value,
                })
              }
            >
              {[
                'not_started',
                'contacted',
                'responded',
                'meeting_booked',
                'qualified',
                'closed',
              ].map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>

          <label className="block">
            Status

            <select
              className={field}
              value={editor.status || 'active'}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  status: event.target.value,
                })
              }
            >
              {[
                'active',
                'paused',
                'completed',
                'not_interested',
              ].map((participantStatus) => (
                <option key={participantStatus}>
                  {participantStatus}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            Note

            <textarea
              className={field}
              maxLength={5000}
              value={editor.note || ''}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  note: event.target.value,
                })
              }
            />
          </label>

          <label className="block">
            First contacted (your local time)

            <input
              className={field}
              type="datetime-local"
              value={toLocalDateTime(editor.first_contacted_at)}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  first_contacted_at: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                })
              }
            />
          </label>

          <label className="block">
            Last contacted (your local time)

            <input
              className={field}
              type="datetime-local"
              value={toLocalDateTime(editor.last_contacted_at)}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  last_contacted_at: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                })
              }
            />
          </label>

          <button className={button} disabled={locked}>
            Save progress
          </button>

          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => setEditor(null)}
          >
            Cancel
          </button>
        </form>
      )}

      {historyName && (
        <section className="lumina-campaign-history space-y-3">
          <div className="lumina-campaign-history-header">
            <h2 className="lumina-campaign-history-title text-xl">
              Campaign history: {historyName}
            </h2>

            <button
              type="button"
              className="lumina-campaign-panel-close"
              onClick={() => {
                setHistoryName('');
                setHistory([]);
                setEvents([]);
              }}
            >
              Close
            </button>
          </div>

          {history.map((record, index) => (
            <div
              className="lumina-campaign-history-card p-4 border border-[#27272a] rounded-lg"
              key={index}
            >
              <strong>{record.campaign_name}</strong>

              <p>
                {record.stage} · {record.participation_status}
              </p>

              <p className="whitespace-pre-wrap">{record.note}</p>
            </div>
          ))}

          <h3>Latest 100 recorded events</h3>

          <p>
            Events start with this release; older changes are not reconstructed.
          </p>

          {events.map((event) => (
            <details
              className="lumina-campaign-event p-3 border border-[#27272a]"
              key={event.id}
            >
              <summary>
                {new Date(event.created_at).toLocaleString()} ·{' '}
                {event.campaign_name} · {event.action}
              </summary>

              <p>Recorded by: {event.actor}</p>

              <div className="space-y-2">
                {event.action === 'added_from_list' ? (
                  <p>Contact added from a lead list.</p>
                ) : (
                  Object.entries(event.details.after || {}).map(
                    ([key, value]) => (
                      <p key={key}>
                        <strong>{key.replaceAll('_', ' ')}</strong>:{' '}
                        {String(event.details.before?.[key] ?? '—')} →{' '}
                        {String(value ?? '—')}
                      </p>
                    ),
                  )
                )}
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
