import React, { useEffect, useRef, useState } from 'react';
import { gate1Api } from '../services/gate1Api';
import type { ContactIntelligence, Person } from '../types';

type ColumnGroup = 'Contact' | 'Company' | 'Intelligence';

interface DatabaseColumn {
  key: string;
  label: string;
  group: ColumnGroup;
  locked?: boolean;
  value?: (row: Person) => React.ReactNode;
}

const secondaryButton =
  'px-6 py-2.5 bg-[#18181b] border border-[#27272a] text-xs font-bold text-[#a1a1aa] hover:text-white rounded-xl disabled:opacity-30';

const primaryButton =
  'px-6 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 disabled:opacity-30';

const columnDefs: DatabaseColumn[] = [
  {
    key: 'name',
    label: 'Name',
    group: 'Contact',
    locked: true,
    value: (row) => row.full_name || 'Name unavailable',
  },
  {
    key: 'title',
    label: 'Title',
    group: 'Contact',
    locked: true,
    value: (row) => row.current_title || '—',
  },
  {
    key: 'company',
    label: 'Company',
    group: 'Company',
    locked: true,
    value: (row) => row.company_name || '—',
  },
  {
    key: 'country',
    label: 'Country',
    group: 'Contact',
    locked: true,
    value: (row) => row.contact_country || row.company_country || '—',
  },
  {
    key: 'email',
    label: 'Email',
    group: 'Contact',
    locked: true,
    value: (row) => row.primary_email || '—',
  },
  {
    key: 'phone',
    label: 'Phone',
    group: 'Contact',
    locked: true,
    value: (row) => row.primary_phone || '—',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    group: 'Contact',
    locked: true,
  },
  {
    key: 'icp',
    label: 'ICP',
    group: 'Intelligence',
    locked: true,
  },
  {
    key: 'department',
    label: 'Department',
    group: 'Contact',
    value: (row) => row.department || '—',
  },
  {
    key: 'seniority',
    label: 'Seniority',
    group: 'Contact',
    value: (row) => row.seniority || '—',
  },
  {
    key: 'city',
    label: 'City',
    group: 'Contact',
    value: (row) => row.contact_city || '—',
  },
  {
    key: 'email_status',
    label: 'Email Status',
    group: 'Contact',
    value: (row) => row.email_validation_status || '—',
  },
  {
    key: 'phone_type',
    label: 'Phone Type',
    group: 'Contact',
    value: (row) => row.primary_phone_type || '—',
  },
  {
    key: 'industry',
    label: 'Industry',
    group: 'Company',
    value: (row) => row.company_industry || '—',
  },
  {
    key: 'domain',
    label: 'Domain',
    group: 'Company',
    value: (row) => row.company_domain || '—',
  },
  {
    key: 'website',
    label: 'Website',
    group: 'Company',
  },
  {
    key: 'company_linkedin',
    label: 'Company LinkedIn',
    group: 'Company',
  },
  {
    key: 'company_city',
    label: 'Company City',
    group: 'Company',
    value: (row) => row.company_city || '—',
  },
  {
    key: 'company_country',
    label: 'Company Country',
    group: 'Company',
    value: (row) => row.company_country || '—',
  },
];

export function Database() {
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [rows, setRows] = useState<Person[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showColumns, setShowColumns] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(
    () =>
      new Set([
        'name',
        'title',
        'company',
        'country',
        'email',
        'phone',
        'linkedin',
        'icp',
      ]),
  );

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [intelligence, setIntelligence] =
    useState<ContactIntelligence | null>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState('');

  const mounted = useRef(true);
  const limit = 50;

  const activeColumns = columnDefs.filter((column) =>
    visibleColumns.has(column.key),
  );

  function toggleColumn(key: string) {
    setVisibleColumns((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function closeIntelligence() {
    setSelectedPerson(null);
    setIntelligence(null);
    setIntelligenceError('');
  }

  async function openIntelligence(row: Person) {
    setSelectedPerson(row);
    setIntelligence(null);
    setIntelligenceError('');
    setIntelligenceBusy(true);

    try {
      const result = await gate1Api.getPersonIntelligence(row.id);

      if (!result?.data || typeof result.data !== 'object') {
        throw new Error('The backend did not return contact intelligence.');
      }

      if (mounted.current) {
        setIntelligence(result.data);
      }
    } catch (err) {
      if (mounted.current) {
        setIntelligenceError(
          err instanceof Error
            ? err.message
            : 'Could not load contact intelligence.',
        );
      }
    } finally {
      if (mounted.current) {
        setIntelligenceBusy(false);
      }
    }
  }

  async function load(search = q, nextOffset = 0) {
    setBusy(true);
    setError('');

    try {
      const result = await gate1Api.searchPeople(
        {
          q: String(search || '').trim(),
          filters: {},
        },
        limit,
        nextOffset,
      );

      if (!Array.isArray(result.data)) {
        throw new Error('The backend did not return database rows.');
      }

      if (mounted.current) {
        setRows(result.data);
        setOffset(nextOffset);
        setAppliedQ(String(search || '').trim());
      }
    } catch (err) {
      if (mounted.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load database contacts.',
        );
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load('', 0);

    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <div className="lumina-database space-y-6 animate-in pb-20">
      <div className="lumina-database-header flex flex-wrap gap-4 items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-tight">
            Database
          </h1>
          <p className="text-sm text-[#71717a] mt-1">
            Search and review your contact intelligence without clutter.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <p className="text-xs text-[#71717a]">
            {rows.length} contacts on this page
          </p>

          <button
            className={secondaryButton}
            type="button"
            onClick={() => setShowColumns((value) => !value)}
          >
            {showColumns ? 'Close Columns' : 'Columns'}
          </button>
        </div>
      </div>

      {showColumns && (
        <div className="p-5 bg-[#111114] border border-[#27272a] rounded-2xl space-y-5">
          <p className="text-sm text-[#a1a1aa]">
            Your essential columns are always visible. Turn on extra information
            only when it helps your work.
          </p>

          {(['Contact', 'Company', 'Intelligence'] as ColumnGroup[]).map(
            (group) => {
              const locked = columnDefs.filter(
                (column) => column.group === group && column.locked,
              );

              const optional = columnDefs.filter(
                (column) => column.group === group && !column.locked,
              );

              return (
                <div className="space-y-3" key={group}>
                  <h3 className="text-xs uppercase tracking-widest text-[#71717a]">
                    {group}
                  </h3>

                  {locked.length > 0 && (
                    <div>
                      <p className="text-[11px] text-[#52525b] mb-2">
                        Always visible
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {locked.map((column) => (
                          <span
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#27272a] text-xs text-[#71717a]"
                            key={column.key}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              lock
                            </span>
                            {column.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {optional.length > 0 && (
                    <div>
                      <p className="text-[11px] text-[#71717a] mb-2">
                        Optional
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {optional.map((column) => (
                          <label
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#3f3f46] text-xs text-[#a1a1aa] cursor-pointer hover:text-white hover:border-[#52525b]"
                            key={column.key}
                          >
                            <input
                              type="checkbox"
                              checked={visibleColumns.has(column.key)}
                              onChange={() => toggleColumn(column.key)}
                              className="accent-indigo-600"
                            />
                            {column.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            },
          )}

          {activeColumns.length > 8 && (
            <p className="text-xs text-indigo-300 border-t border-[#27272a] pt-4">
              <span className="material-symbols-outlined text-[14px] align-middle mr-1">
                swap_horiz
              </span>
              Extra columns are enabled. Scroll the table horizontally to view
              fields beyond the screen.
            </p>
          )}
        </div>
      )}

      <form
        className="lumina-database-search flex gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load(q, 0);
        }}
      >
        <input
          aria-label="Search database"
          value={q}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, title, company or email…"
          className="flex-1 p-3 bg-[#111114] border border-[#27272a] rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
        />

        <button className={primaryButton} disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300"
        >
          {error}
        </div>
      )}

      <div className="lumina-database-table bg-[#0d0d0f] border border-[#1c1c1f] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="lumina-data-grid w-full text-left text-sm">
            <thead className="lumina-data-grid-head bg-[#111114] border-b border-[#1c1c1f]">
              <tr>
                {activeColumns.map((column) => (
                  <th
                    className="px-5 py-4 text-xs uppercase tracking-widest text-[#71717a]"
                    key={column.key}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-[#1c1c1f]">
              {rows.map((row) => (
                <tr
                  className="lumina-data-row hover:bg-[#18181b] cursor-pointer"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;

                    if (target.closest?.('a,button,input,label')) {
                      return;
                    }

                    void openIntelligence(row);
                  }}
                  key={row.id}
                >
                  {activeColumns.map((column) => {
                    let content: React.ReactNode = '—';

                    if (column.key === 'linkedin') {
                      content = row.linkedin_url ? (
                        <a
                          href={row.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Open
                        </a>
                      ) : (
                        '—'
                      );
                    } else if (column.key === 'company_linkedin') {
                      content = row.company_linkedin_url ? (
                        <a
                          href={row.company_linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Open
                        </a>
                      ) : (
                        '—'
                      );
                    } else if (column.key === 'website') {
                      content = row.company_website ? (
                        <a
                          href={row.company_website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Open
                        </a>
                      ) : (
                        '—'
                      );
                    } else if (column.key === 'icp') {
                      content = row.icp_tags?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {row.icp_tags.map((tag) => (
                            <span
                              className="text-xs text-indigo-300 border border-indigo-500/30 rounded px-2 py-1"
                              key={tag.id}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '—'
                      );
                    } else {
                      content = column.value ? column.value(row) : '—';
                    }

                    return (
                      <td
                        className={
                          column.key === 'name'
                            ? 'px-5 py-4 font-semibold text-white'
                            : 'px-5 py-4 text-[#a1a1aa]'
                        }
                        key={column.key}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {!rows.length && (
                <tr>
                  <td
                    colSpan={activeColumns.length || 1}
                    className="py-20 text-center text-[#71717a]"
                  >
                    {busy ? 'Loading contacts…' : 'No matching contacts.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPerson && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={closeIntelligence}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Contact intelligence"
            className="w-full h-full overflow-y-auto shadow-2xl"
            style={{
              width: 'min(720px,100vw)',
              maxWidth: '720px',
              borderLeft: '1px solid rgba(255,255,255,0.10)',
              background:
                'radial-gradient(circle at 100% 0%,rgba(99,102,241,0.18),transparent 34%),radial-gradient(circle at 0% 42%,rgba(14,165,233,0.07),transparent 30%),linear-gradient(180deg,#171925 0%,#12141e 46%,#0f1118 100%)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex items-start justify-between gap-4"
              style={{
                padding: '24px 28px',
                borderBottom: '1px solid rgba(255,255,255,0.10)',
                background:
                  'linear-gradient(135deg,rgba(79,70,229,0.30),rgba(67,56,202,0.16) 36%,rgba(30,41,59,0.90) 100%)',
                backdropFilter: 'blur(18px)',
              }}
            >
              <div className="min-w-0">
                <p
                  className="text-[11px] uppercase text-indigo-300"
                  style={{ letterSpacing: '0.24em' }}
                >
                  Contact Intelligence
                </p>

                <h2 className="text-2xl font-semibold text-white mt-2 truncate tracking-tight">
                  {selectedPerson.full_name || 'Name unavailable'}
                </h2>

                <p className="text-sm text-[#b6b8c5] mt-1">
                  {[
                    selectedPerson.current_title,
                    selectedPerson.company_name,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Profile details'}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close contact intelligence"
                className="w-10 h-10 shrink-0 rounded-xl text-[#a1a1aa] hover:text-white transition"
                style={{
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.02)',
                }}
                onClick={closeIntelligence}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-7" style={{ padding: '28px' }}>
              {intelligenceBusy && (
                <div
                  role="status"
                  className="py-16 text-center text-[#a1a1aa]"
                >
                  <span className="material-symbols-outlined text-3xl animate-pulse">
                    manage_search
                  </span>
                  <p className="mt-3 text-sm">
                    Loading contact intelligence…
                  </p>
                </div>
              )}

              {intelligenceError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300"
                >
                  <p>{intelligenceError}</p>

                  <button
                    type="button"
                    className={`${secondaryButton} mt-3`}
                    disabled={intelligenceBusy}
                    onClick={() => void openIntelligence(selectedPerson)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {intelligence && !intelligenceBusy && (
                <>
                  <section
                    className="rounded-2xl"
                    style={{
                      padding: '16px 18px',
                      border: '1px solid rgba(129,140,248,0.22)',
                      background:
                        'linear-gradient(135deg,rgba(99,102,241,0.16),rgba(30,41,59,0.46))',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,0.035)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        Freshness
                      </h3>

                      <span
                        className="px-3 py-1 rounded-full text-xs font-medium text-indigo-200"
                        style={{
                          border: '1px solid rgba(129,140,248,0.30)',
                          background: 'rgba(129,140,248,0.10)',
                        }}
                      >
                        {intelligence.freshness?.latest?.freshness_result
                          ? String(
                              intelligence.freshness.latest.freshness_result,
                            ).replaceAll('_', ' ')
                          : intelligence.freshness?.open
                            ? 'Verification pending'
                            : 'Not yet verified'}
                      </span>
                    </div>

                    <div
                      className="text-sm"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
                        gap: '18px',
                        marginTop: '14px',
                        paddingTop: '14px',
                        borderTop: '1px solid rgba(255,255,255,0.07)',
                      }}
                    >
                      <div>
                        <p className="text-xs text-[#71717a]">
                          Last verified
                        </p>
                        <p className="text-[#e4e4e7] mt-1">
                          {intelligence.freshness?.latest?.completed_at
                            ? new Date(
                                intelligence.freshness.latest.completed_at,
                              ).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-[#71717a]">Confidence</p>
                        <p className="text-[#e4e4e7] mt-1">
                          {Number.isFinite(
                            intelligence.freshness?.latest?.confidence,
                          )
                            ? `${intelligence.freshness?.latest?.confidence}%`
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-[#71717a]">
                      Contact
                    </h3>

                    <dl
                      className="rounded-2xl"
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit,minmax(220px,1fr))',
                        gap: '10px',
                      }}
                    >
                      {[
                        ['Email', intelligence.contact?.primary_email],
                        [
                          'Email status',
                          intelligence.contact?.email_validation_status,
                        ],
                        ['Phone', intelligence.contact?.primary_phone],
                        ['Phone type', intelligence.contact?.primary_phone_type],
                        [
                          'Location',
                          [
                            intelligence.person?.contact_city,
                            intelligence.person?.contact_country,
                          ]
                            .filter(Boolean)
                            .join(', '),
                        ],
                        ['Department', intelligence.person?.department],
                        ['Seniority', intelligence.person?.seniority],
                      ].map(([label, value]) => (
                        <div
                          className="min-w-0"
                          style={{
                            padding: '13px 15px',
                            border:
                              '1px solid rgba(148,163,184,0.10)',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.025)',
                            boxShadow:
                              'inset 0 1px 0 rgba(255,255,255,0.018)',
                          }}
                          key={String(label)}
                        >
                          <dt
                            className="text-[10px] uppercase text-[#747786]"
                            style={{ letterSpacing: '0.16em' }}
                          >
                            {label}
                          </dt>

                          <dd className="text-sm text-[#f4f4f5] mt-1 break-words font-medium">
                            {value || '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  {intelligence.person?.linkedin_url && (
                    <a
                      href={intelligence.person.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5 text-indigo-300 hover:bg-indigo-500/10"
                    >
                      <span>Open LinkedIn profile</span>
                      <span className="material-symbols-outlined text-lg">
                        open_in_new
                      </span>
                    </a>
                  )}

                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-[#71717a]">
                      Company
                    </h3>

                    {intelligence.company ? (
                      <div
                        className="p-5 rounded-2xl space-y-3"
                        style={{
                          border: '1px solid rgba(96,165,250,0.14)',
                          background:
                            'linear-gradient(135deg,rgba(59,130,246,0.075),rgba(255,255,255,0.025))',
                          boxShadow:
                            'inset 0 1px 0 rgba(255,255,255,0.025)',
                        }}
                      >
                        <p className="font-semibold text-white">
                          {intelligence.company.name || 'Company unavailable'}
                        </p>

                        <p className="text-sm text-[#a1a1aa]">
                          {intelligence.company.industry ||
                            'Industry unavailable'}
                        </p>

                        <p className="text-sm text-[#71717a]">
                          {[
                            intelligence.company.city,
                            intelligence.company.country,
                          ]
                            .filter(Boolean)
                            .join(', ') || 'Location unavailable'}
                        </p>

                        {intelligence.company.website && (
                          <a
                            href={intelligence.company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200"
                          >
                            Open company website
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-[#71717a]">
                        No current company is recorded.
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-[#71717a]">
                        Intelligence
                      </h3>
                      <span className="text-xs text-[#52525b]">
                        {intelligence.enrichment?.length || 0} attributes
                      </span>
                    </div>

                    {intelligence.enrichment?.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {intelligence.enrichment.map((item, index) => (
                          <div
                            className="p-4 rounded-xl"
                            style={{
                              border:
                                '1px solid rgba(167,139,250,0.16)',
                              background:
                                'linear-gradient(135deg,rgba(139,92,246,0.085),rgba(255,255,255,0.018))',
                            }}
                            key={
                              item.id ||
                              item.attribute_key ||
                              String(index)
                            }
                          >
                            <p className="text-[11px] uppercase tracking-wider text-[#71717a]">
                              {item.attribute_label ||
                                item.attribute_key ||
                                'Attribute'}
                            </p>

                            <p className="text-sm text-white mt-1 break-words">
                              {item.value === null ||
                              item.value === undefined
                                ? '—'
                                : typeof item.value === 'object'
                                  ? JSON.stringify(item.value)
                                  : String(item.value)}
                            </p>

                            {item.source_name && (
                              <p className="text-[11px] text-[#52525b] mt-2">
                                Source: {item.source_name}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[#71717a]">
                        No enrichment yet.
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-[#71717a]">
                        Employment History
                      </h3>

                      <span className="text-xs text-[#52525b]">
                        {intelligence.employment_history?.length || 0} records
                      </span>
                    </div>

                    {intelligence.employment_history?.length ? (
                      intelligence.employment_history.map((job) => (
                        <div
                          className="p-4 rounded-xl"
                          style={{
                            border:
                              '1px solid rgba(56,189,248,0.15)',
                            background:
                              'linear-gradient(135deg,rgba(14,165,233,0.07),rgba(255,255,255,0.018))',
                          }}
                          key={job.id}
                        >
                          <div className="flex justify-between gap-3">
                            <div>
                              <p className="font-medium text-white">
                                {job.title || 'Title unavailable'}
                              </p>

                              <p className="text-sm text-[#a1a1aa] mt-1">
                                {job.company_name || 'Company unavailable'}
                              </p>
                            </div>

                            {job.is_current && (
                              <span className="text-xs text-emerald-300">
                                Current
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-[#71717a] mt-2">
                            {[job.department, job.seniority]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[#71717a]">
                        No employment history is recorded.
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-[#71717a]">
                        Campaign Activity
                      </h3>

                      <span className="text-xs text-[#52525b]">
                        {intelligence.campaigns?.length || 0} campaigns
                      </span>
                    </div>

                    {intelligence.campaigns?.length ? (
                      intelligence.campaigns.map((campaign) => (
                        <div
                          className="p-4 rounded-xl"
                          style={{
                            border:
                              '1px solid rgba(34,211,238,0.15)',
                            background:
                              'linear-gradient(135deg,rgba(6,182,212,0.07),rgba(255,255,255,0.018))',
                          }}
                          key={campaign.campaign_id}
                        >
                          <div className="flex justify-between gap-3">
                            <p className="font-medium text-white">
                              {campaign.campaign_name || 'Campaign'}
                            </p>

                            <span className="text-xs text-indigo-300">
                              {campaign.stage
                                ? String(campaign.stage).replaceAll('_', ' ')
                                : '—'}
                            </span>
                          </div>

                          <p className="text-xs text-[#71717a] mt-2">
                            {campaign.participation_status
                              ? String(
                                  campaign.participation_status,
                                ).replaceAll('_', ' ')
                              : '—'}
                          </p>

                          {campaign.note && (
                            <p className="text-sm text-[#a1a1aa] mt-3 whitespace-pre-wrap">
                              {campaign.note}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[#71717a]">
                        No campaign activity yet.
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#71717a]">
          Page {Math.floor(offset / limit) + 1} · {rows.length} contacts
        </p>

        <div className="flex gap-2">
          <button
            className={secondaryButton}
            disabled={busy || offset === 0}
            onClick={() =>
              void load(appliedQ, Math.max(0, offset - limit))
            }
          >
            Previous
          </button>

          <button
            className={secondaryButton}
            disabled={busy || rows.length < limit}
            onClick={() => void load(appliedQ, offset + limit)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
