import React, { useEffect, useRef, useState } from 'react';
import { useSession } from '../components/Session';
import { ApiError } from '../services/gate1Api';
import {
  importApi,
  type ImportReviewPage,
  type ImportReviewRow,
} from '../services/importApi';

const button =
  'px-4 py-2 rounded-xl border border-[#27272a] text-sm text-white disabled:opacity-40 hover:bg-[#18181b]';

const primary =
  button + ' bg-indigo-600 border-indigo-500 hover:bg-indigo-500';

const input =
  'bg-[#111114] border border-[#27272a] rounded-xl p-3 text-sm text-white';

const outcomeLabels: Record<string, string> = {
  all: 'All rows',
  inserted: 'Inserted',
  updated: 'Updated',
  matched: 'Matched',
  processed: 'Processed',
  review: 'Needs review',
  rejected: 'Rejected',
  suppressed: 'Suppressed',
  pending: 'Pending',
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function sourceName(row: ImportReviewRow) {
  return (
    stringValue(row.raw_payload.full_name) ||
    [
      stringValue(row.raw_payload.first_name),
      stringValue(row.raw_payload.last_name),
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function selectable(row: ImportReviewRow) {
  return (
    !!row.person_id &&
    row.person_status === 'active' &&
    ['inserted', 'updated', 'matched', 'processed'].includes(row.outcome)
  );
}

function safeLinkedIn(value?: string | null) {
  return value &&
    /^https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\//i.test(value)
    ? value
    : null;
}

export function ImportReview({
  jobId,
  onBack,
  onOpenLists,
}: {
  jobId: string;
  onBack: () => void;
  onOpenLists: () => void;
}) {
  const session = useSession();

  const [page, setPage] = useState<ImportReviewPage | null>(null);

  const [outcome, setOutcome] = useState('all');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [listName, setListName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedListName, setSavedListName] = useState('');
  const [uncertain, setUncertain] = useState(false);

  const pendingList = useRef<{
    id: string;
    name: string;
    person_ids: string[];
  } | null>(null);

  const writeLock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError('');
    setSelected(new Set());
    setPage(null);

    importApi
      .getReviewRows(jobId, outcome, offset, query, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;

        if (
          value.job.id !== jobId ||
          value.job.client_id !== session.client_id
        ) {
          throw new Error('The review did not match this import and client.');
        }

        setPage(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load this import.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    jobId,
    session.client_id,
    outcome,
    offset,
    query,
    refreshToken,
  ]);

  const selectableIds = [
    ...new Set(
      (page?.rows || [])
        .filter(selectable)
        .map((row) => row.person_id)
        .filter((id): id is string => !!id),
    ),
  ];

  function toggle(personId: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }

      return next;
    });
  }

  async function createList() {
    if (writeLock.current) return;

    writeLock.current = true;
    setSaving(true);
    setError('');

    const submission =
      pendingList.current ?? {
        id: crypto.randomUUID(),
        name: listName.trim(),
        person_ids: [...selected].sort(),
      };

    pendingList.current = submission;

    try {
      const result = await importApi.createReviewList(jobId, submission);

      if (mounted.current) {
        setSavedListName(result.name);
        setUncertain(false);
        setSelected(new Set());
        pendingList.current = null;
      }
    } catch (err) {
      if (mounted.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not save the lead list.',
        );

        setUncertain(
          err instanceof ApiError ? err.uncertainWrite : true,
        );
      }
    } finally {
      writeLock.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  }

  const locked = loading || saving || uncertain;

  const uploadedAt = page?.job.created_at
    ? new Date(page.job.created_at).toLocaleString()
    : '';

  return (
    <div className="lumina-import-review space-y-6 max-w-6xl">
      <button className={button} onClick={onBack} disabled={saving}>
        ← Back to import
      </button>

      <header>
        <p className="text-xs uppercase tracking-widest text-indigo-400">
          Database / Import review
        </p>

        <h1 className="lumina-import-review-title text-3xl font-bold text-white mt-3">
          Review imported contacts
        </h1>

        <p className="text-sm text-[#a1a1aa] mt-3">
          Only rows from this upload appear here. Review them, then select saved
          contacts to create a lead list.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-500/10 text-rose-200"
        >
          <p>{error}</p>

          {!page && !loading && (
            <button
              className={`${button} mt-3`}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              Retry loading this import
            </button>
          )}
        </div>
      )}

      {page && (
        <section className="lumina-import-review-summary p-6 rounded-2xl border border-[#27272a] bg-[#0d0d0f] space-y-4">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">
                {page.job.filename}
              </h2>

              <p className="text-sm text-[#a1a1aa] mt-2">
                {uploadedAt} · Source: {page.job.source_name} ·{' '}
                {page.job.status}
              </p>

              <p className="text-xs text-[#71717a] mt-2">
                Uploaded by:{' '}
                {page.job.metadata?.uploaded_by ||
                  page.job.metadata?.principal_id ||
                  'Not recorded for this job'}
              </p>
            </div>

            <button
              className={button}
              disabled={saving || uncertain}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              Refresh review
            </button>
          </div>

          <dl className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              ['Processed', `${page.job.processed_rows} / ${page.job.total_rows}`],
              ['Inserted', page.job.inserted_rows],
              ['Updated', page.job.updated_rows],
              ['Matched', page.job.matched_rows],
              ['Rejected', page.job.rejected_rows],
              ['Conflicts at import', page.job.conflict_rows],
              ['Suppressed', page.job.suppressed_rows],
            ].map(([label, value]) => (
              <div className="p-3 rounded-xl bg-[#111114]" key={label}>
                <dt className="text-xs text-[#a1a1aa]">{label}</dt>
                <dd className="text-xl text-white mt-2">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-[#a1a1aa]">
            Matched means an existing contact was found without a canonical
            change. Needs review can involve company fields. Import outcomes
            describe this upload; contact details below show the current
            database values.
          </p>
        </section>
      )}

      <form
        className="lumina-import-review-filters flex flex-wrap gap-3 items-center"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setQuery(queryInput.trim());
        }}
      >
        <label className="text-sm">
          Outcome{' '}
          <select
            aria-label="Filter import outcome"
            className={`${input} ml-2`}
            value={outcome}
            disabled={locked}
            onChange={(event) => {
              setOutcome(event.target.value);
              setOffset(0);
            }}
          >
            {Object.entries(outcomeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex-1 min-w-48">
          <span className="sr-only">
            Find a name, email or company in this import
          </span>

          <input
            className={`${input} w-full`}
            placeholder="Find a name, email or company in this import"
            value={queryInput}
            maxLength={200}
            disabled={locked}
            onChange={(event) => setQueryInput(event.target.value)}
          />
        </label>

        <button className={button} disabled={locked}>
          Find in this import
        </button>
      </form>

      <div
        role="status"
        aria-live="polite"
        className="text-sm text-[#a1a1aa]"
      >
        {loading
          ? 'Loading import rows…'
          : page
            ? `${page.total} rows match · ${page.rows.length} on this page · ${selected.size} contacts selected`
            : ''}
      </div>

      {page && (
        <div className="lumina-import-review-table-wrap overflow-x-auto rounded-2xl border border-[#27272a]">
          <table className="lumina-import-review-table w-full text-left text-sm">
            <thead className="bg-[#111114]">
              <tr>
                <th className="p-4">
                  <input
                    type="checkbox"
                    aria-label="Select all saved contacts on this page"
                    disabled={
                      locked ||
                      !page.can_create_list ||
                      !selectableIds.length
                    }
                    checked={
                      !!selectableIds.length &&
                      selectableIds.every((id) => selected.has(id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? new Set(selectableIds)
                          : new Set(),
                      )
                    }
                  />
                </th>

                {[
                  'Row',
                  'Contact',
                  'Company / country',
                  'Outcome',
                  'Details',
                ].map((heading) => (
                  <th scope="col" className="p-4" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {page.rows.map((row) => (
                <tr
                  className="lumina-import-review-row border-t border-[#27272a] align-top"
                  key={row.row_id}
                >
                  <td className="p-4">
                    <input
                      type="checkbox"
                      aria-label={`Select row ${row.row_number}`}
                      checked={
                        !!row.person_id && selected.has(row.person_id)
                      }
                      disabled={
                        locked ||
                        !page.can_create_list ||
                        !selectable(row)
                      }
                      onChange={() =>
                        row.person_id && toggle(row.person_id)
                      }
                    />
                  </td>

                  <td className="p-4 text-[#a1a1aa]">
                    {row.row_number}
                  </td>

                  <td className="p-4">
                    <p className="font-semibold text-white">
                      {row.full_name ||
                        sourceName(row) ||
                        'Name unavailable'}
                    </p>

                    <p className="text-xs text-[#a1a1aa] mt-1">
                      {row.current_title ||
                        stringValue(row.raw_payload.current_title) ||
                        '—'}
                    </p>

                    <p className="mt-2 break-all">
                      {row.email ||
                        stringValue(row.raw_payload.email) ||
                        'No email supplied'}
                    </p>

                    {!row.person_id && (
                      <p className="text-xs text-amber-200 mt-1">
                        Source values · no linked contact
                      </p>
                    )}
                  </td>

                  <td className="p-4">
                    {row.company_name ||
                      stringValue(row.raw_payload.company_name) ||
                      'Company unavailable'}

                    <p className="text-xs text-[#a1a1aa] mt-2">
                      {row.contact_country ||
                        stringValue(row.raw_payload.contact_country) ||
                        'Country unavailable'}
                    </p>
                  </td>

                  <td className="p-4">
                    <span
                      className={
                        ['review', 'rejected'].includes(row.outcome)
                          ? 'text-amber-200'
                          : 'text-indigo-300'
                      }
                    >
                      {outcomeLabels[row.outcome] || 'Needs review'}
                    </span>

                    {row.reason && (
                      <p className="text-xs text-[#a1a1aa] mt-2">
                        {row.reason.replaceAll('_', ' ')}
                      </p>
                    )}

                    {row.person_status &&
                      row.person_status !== 'active' && (
                        <p className="text-xs text-amber-200 mt-2">
                          Contact is {row.person_status}
                        </p>
                      )}
                  </td>

                  <td className="p-4 min-w-48">
                    <details>
                      <summary className="cursor-pointer text-indigo-300">
                        View details
                      </summary>

                      <dl className="text-xs space-y-2 mt-3">
                        <dt className="text-[#71717a]">
                          Current title
                        </dt>
                        <dd>{row.current_title || '—'}</dd>

                        <dt className="text-[#71717a]">
                          Department / seniority
                        </dt>
                        <dd>
                          {[row.department, row.seniority]
                            .filter(Boolean)
                            .join(' / ') || '—'}
                        </dd>

                        <dt className="text-[#71717a]">Profile</dt>
                        <dd className="break-all">
                          {safeLinkedIn(row.linkedin_url) ? (
                            <a
                              className="underline"
                              href={safeLinkedIn(row.linkedin_url) || undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open LinkedIn profile
                            </a>
                          ) : (
                            row.linkedin_url || '—'
                          )}
                        </dd>

                        <dt className="text-[#71717a]">
                          Source name / title
                        </dt>
                        <dd>
                          {sourceName(row) || '—'} /{' '}
                          {stringValue(row.raw_payload.current_title) || '—'}
                        </dd>

                        <dt className="text-[#71717a]">
                          Source company / email
                        </dt>
                        <dd className="break-all">
                          {stringValue(row.raw_payload.company_name) || '—'} /{' '}
                          {stringValue(row.raw_payload.email) || '—'}
                        </dd>

                        <dt className="text-[#71717a]">Source phone</dt>
                        <dd>
                          {[
                            stringValue(row.raw_payload.contact_phone_1),
                            stringValue(row.raw_payload.contact_phone_2),
                          ]
                            .filter(Boolean)
                            .join(' / ') || '—'}
                        </dd>
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}

              {!page.rows.length && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-10 text-center text-[#a1a1aa]"
                  >
                    No rows match this filter. Try All rows or clear the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-center gap-3">
        <button
          className={button}
          disabled={locked || !page || offset === 0}
          onClick={() =>
            setOffset((value) => Math.max(0, value - 50))
          }
        >
          Previous
        </button>

        <span className="text-sm text-[#71717a]">
          Page {Math.floor(offset / 50) + 1} · Selection applies to this page
        </span>

        <button
          className={button}
          disabled={
            locked ||
            !page ||
            offset + 50 >= page.total
          }
          onClick={() => setOffset((value) => value + 50)}
        >
          Next
        </button>
      </div>

      {page?.can_create_list ? (
        <section className="lumina-import-review-create-list p-6 rounded-2xl border border-[#27272a] space-y-3">
          <h2 className="text-lg text-white font-semibold">
            Create a lead list from this import
          </h2>

          <p className="text-sm text-[#a1a1aa]">
            Select saved contacts on this page. Rejected, suppressed, pending
            and review rows cannot be selected.
          </p>

          <label className="block text-sm">
            List name

            <input
              className={`${input} block mt-2 w-full`}
              value={listName}
              maxLength={300}
              disabled={saving || uncertain || !!savedListName}
              onChange={(event) => setListName(event.target.value)}
            />
          </label>

          <button
            className={primary}
            disabled={
              saving ||
              loading ||
              !!savedListName ||
              (!uncertain && (!selected.size || !listName.trim()))
            }
            onClick={() => {
              void createList();
            }}
          >
            {saving
              ? 'Saving…'
              : uncertain
                ? 'Check the same list submission'
                : 'Create lead list'}
          </button>

          {uncertain && (
            <p className="text-sm text-amber-200">
              Keep this page open. Retry checks the same list ID and selection
              to avoid creating another list.
            </p>
          )}

          {savedListName && (
            <div role="status">
              <p className="text-sm text-emerald-300">
                Saved: {savedListName}
              </p>

              <div className="flex flex-wrap gap-3 mt-3">
                <button className={button} onClick={onOpenLists}>
                  Open lead lists
                </button>

                <button
                  className={button}
                  onClick={() => {
                    setSavedListName('');
                    setListName('');
                    setSelected(new Set());
                  }}
                >
                  Create another list
                </button>
              </div>
            </div>
          )}
        </section>
      ) : page ? (
        <p className="text-sm text-[#a1a1aa]">
          Your role can review this import. Creating a lead list requires a
          write role.
        </p>
      ) : null}
    </div>
  );
}
