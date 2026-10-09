import { normalizeCountryFields } from './country-fields.js';
import { isContactEmail, isCompanyWebsite, isCompanyDomain } from './contact-fields.js';
import { isPersonLinkedIn } from './person-linkedin.js';
import crypto from 'node:crypto';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { resolveCompany, upsertEmployment } from './company-resolver.js';
import { findSuppression, recordSuppressionHit } from './suppression-resolver.js';
import { upsertPhones } from './phone-resolver.js';
import { evaluatePersonFieldPolicies } from './person-field-policy.js';
import { findAndStoreDuplicateCandidates } from './duplicate-candidate.js';
import { persistSynchronousImportFailure } from './import-failure.js';

export function registerImportRoutes(app, pool) {
  function text(value, max = 1000) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return v ? v.slice(0, max) : null;
  }

  function sha256(value) {
    return crypto
      .createHash('sha256')
      .update(value)
      .digest('hex');
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
  }

  const SYNC_IMPORT_MAX_ROWS = 50;
  const ASYNC_IMPORT_MAX_ROWS = 5000;
  const ASYNC_IMPORT_CHUNK_ROWS = 200;
  const FILE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: FILE_IMPORT_MAX_BYTES,
      files: 1
    }
  });

  const HEADER_ALIASES = new Map([
    ['contact first name', 'first_name'],
    ['contact last name', 'last_name'],
    ['company name (corrected)', 'company_name'],
    ['title (corrected)', 'current_title'],
    ['contact full name', 'full_name'],
    ['email 1', 'email'],
    ['contact li profile url', 'linkedin_url'],
    ['company name cleaned', 'company_name'],
    ['company li profile url', 'company_linkedin_url'],
    ['source record id', 'source_record_id'],
    ['source_record_id', 'source_record_id'],
    ['record id', 'source_record_id'],
    ['external id', 'source_record_id'],

    ['name', 'full_name'],
    ['full name', 'full_name'],
    ['fullname', 'full_name'],
    ['contact name', 'full_name'],
    ['first name', 'first_name'],
    ['last name', 'last_name'],

    ['linkedin', 'linkedin_url'],
    ['linkedin url', 'linkedin_url'],
    ['linkedin profile', 'linkedin_url'],
    ['profile url', 'linkedin_url'],

    ['email', 'email'],
    ['email address', 'email'],
    ['work email', 'email'],

    ['title', 'current_title'],
    ['job title', 'current_title'],
    ['current title', 'current_title'],
    ['role', 'current_title'],
    ['department', 'department'],
    ['seniority', 'seniority'],

    ['phone', 'contact_phone_1'],
    ['phone number', 'contact_phone_1'],
    ['mobile', 'contact_phone_1'],
    ['mobile number', 'contact_phone_1'],
    ['contact phone', 'contact_phone_1'],

    ['city', 'contact_city'],
    ['contact city', 'contact_city'],
    ['country', 'contact_country'],
    ['contact country', 'contact_country'],

    ['company', 'company_name'],
    ['company name', 'company_name'],
    ['organization', 'company_name'],
    ['organisation', 'company_name'],

    ['domain', 'company_domain'],
    ['company domain', 'company_domain'],
    ['website', 'company_website'],
    ['company website', 'company_website'],

    ['company linkedin', 'company_linkedin_url'],
    ['company linkedin url', 'company_linkedin_url'],

    ['industry', 'company_industry'],
    ['company industry', 'company_industry'],
    ['company description', 'company_description'],
    ['description', 'company_description'],

    ['founded date', 'company_founded_date'],
    ['company founded date', 'company_founded_date'],
    ['revenue range', 'company_revenue_range'],
    ['company revenue range', 'company_revenue_range'],
    ['staff count range', 'company_staff_count_range'],
    ['employee range', 'company_staff_count_range'],
    ['employee count range', 'company_staff_count_range'],

    ['company street', 'company_street_1'],
    ['company address', 'company_street_1'],
    ['company city', 'company_city'],
    ['company state', 'company_state'],
    ['company postcode', 'company_post_code'],
    ['company postal code', 'company_post_code'],
    ['company country', 'company_country']
  ]);

  function normalizeHeader(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function fallbackHeader(value) {
    return normalizeHeader(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function buildHeaderMapping(headers) {
    if (!Array.isArray(headers) || headers.length === 0) {
      const error = new Error('FILE_HEADERS_REQUIRED');
      error.code = 'FILE_HEADERS_REQUIRED';
      throw error;
    }

    const mapping = [];
    const seenTargets = new Set();

    for (const originalValue of headers) {
      const original = String(originalValue ?? '').trim();

      if (!original) {
        const error = new Error('EMPTY_FILE_HEADER');
        error.code = 'EMPTY_FILE_HEADER';
        throw error;
      }

      const normalized = normalizeHeader(original);

      const target =
        HEADER_ALIASES.get(normalized) ||
        fallbackHeader(original);

      if (!target) {
        const error = new Error('INVALID_FILE_HEADER');
        error.code = 'INVALID_FILE_HEADER';
        throw error;
      }

      if (seenTargets.has(target)) {
        const error =
          new Error(
            `DUPLICATE_MAPPED_HEADER:${target}`
          );

        error.code =
          'DUPLICATE_MAPPED_HEADER';

        error.targetField = target;

        throw error;
      }

      seenTargets.add(target);

      mapping.push({
        original,
        target
      });
    }

    return mapping;
  }

  function scalarCellValue(value) {
    if (value == null) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value !== 'object') {
      return String(value).trim();
    }

    if (
      Object.prototype.hasOwnProperty.call(
        value,
        'result'
      )
    ) {
      return scalarCellValue(value.result);
    }

    if (Array.isArray(value.richText)) {
      return value.richText
        .map(item => item?.text || '')
        .join('')
        .trim();
    }

    if (value.text != null) {
      return String(value.text).trim();
    }

    if (value.hyperlink != null) {
      return String(
        value.text || value.hyperlink
      ).trim();
    }

    return String(value).trim();
  }

  function mappedObject(values, mapping) {
    if (values.slice(mapping.length).some(value => String(value ?? '').trim())) {
      const error = new Error('FILE_COLUMN_COUNT_MISMATCH');
      error.code = 'FILE_COLUMN_COUNT_MISMATCH';
      throw error;
    }
    const output = {};

    for (
      let index = 0;
      index < mapping.length;
      index++
    ) {
      const target = mapping[index].target;
      const value = values[index] ?? '';

      output[target] =
        typeof value === 'string'
          ? value.trim()
          : value;
    }

    return output;
  }

  function parseCsvUpload(buffer) {
    const records = parseCsv(
      buffer.toString('utf8'),
      {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false
      }
    );

    if (records.length === 0) {
      const error = new Error('FILE_EMPTY');
      error.code = 'FILE_EMPTY';
      throw error;
    }

    const headers = records[0];
    const mapping =
      buildHeaderMapping(headers);

    const dataRows = records
      .slice(1)
      .filter(row =>
        row.some(value =>
          String(value ?? '').trim() !== ''
        )
      );

    if (
      dataRows.length >
      ASYNC_IMPORT_MAX_ROWS
    ) {
      const error =
        new Error('BATCH_TOO_LARGE');

      error.code = 'BATCH_TOO_LARGE';
      error.maxRows = ASYNC_IMPORT_MAX_ROWS;
      error.actualRows = dataRows.length;

      throw error;
    }

    return {
      rows:
        dataRows.map(row =>
          mappedObject(row, mapping)
        ),
      headerMapping: mapping,
      worksheetName: null
    };
  }

  async function parseXlsxUpload(buffer) {
    const workbook =
      new ExcelJS.Workbook();

    await workbook.xlsx.load(buffer);

    const worksheet =
      workbook.worksheets[0];

    if (!worksheet) {
      const error =
        new Error('XLSX_WORKSHEET_REQUIRED');

      error.code =
        'XLSX_WORKSHEET_REQUIRED';

      throw error;
    }

    let headerValues = null;
    const dataValues = [];

    worksheet.eachRow(
      { includeEmpty: false },
      row => {
        const values = [];

        for (
          let column = 1;
          column <= row.cellCount;
          column++
        ) {
          values.push(
            scalarCellValue(
              row.getCell(column).value
            )
          );
        }

        const hasValue =
          values.some(
            value =>
              String(value ?? '').trim() !== ''
          );

        if (!hasValue) {
          return;
        }

        if (!headerValues) {
          headerValues = values;
          return;
        }

        if (
          dataValues.length <=
          ASYNC_IMPORT_MAX_ROWS
        ) {
          dataValues.push(values);
        }
      }
    );

    if (!headerValues) {
      const error = new Error('FILE_EMPTY');
      error.code = 'FILE_EMPTY';
      throw error;
    }

    if (
      dataValues.length >
      ASYNC_IMPORT_MAX_ROWS
    ) {
      const error =
        new Error('BATCH_TOO_LARGE');

      error.code = 'BATCH_TOO_LARGE';
      error.maxRows = ASYNC_IMPORT_MAX_ROWS;
      error.actualRows = dataValues.length;

      throw error;
    }

    const mapping =
      buildHeaderMapping(headerValues);

    return {
      rows:
        dataValues.map(row =>
          mappedObject(row, mapping)
        ),
      headerMapping: mapping,
      worksheetName: worksheet.name
    };
  }

  async function parseUploadedFile(file) {
    const filename =
      String(file?.originalname || '');

    const lower =
      filename.toLowerCase();

    if (lower.endsWith('.csv')) {
      return {
        inputType: 'csv',
        ...(parseCsvUpload(file.buffer))
      };
    }

    if (lower.endsWith('.xlsx')) {
      return {
        inputType: 'xlsx',
        ...(await parseXlsxUpload(
          file.buffer
        ))
      };
    }

    const error =
      new Error('UNSUPPORTED_FILE_TYPE');

    error.code =
      'UNSUPPORTED_FILE_TYPE';

    throw error;
  }


  async function processImportRows(
    client,
    {
      rows,
      importJobId,
      clientId,
      sourceName
    }
  ) {
    let inserted = 0;
    let updated = 0;
    let matched = 0;
    let duplicates = 0;
    let rejected = 0;
    let conflicts = 0;
    let suppressed = 0;

    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const rowEnvelope = rows[i] || {};
      let row = rowEnvelope.__lumina_payload || rowEnvelope;
      const rowNumber = Number(
        rowEnvelope.__lumina_row_number || (i + 1)
      );
      const existingRawRowId =
        rowEnvelope.__lumina_raw_row_id || null;

      const sourceRecordId =
        text(row.source_record_id, 500);

      const rowHash =
        sha256(JSON.stringify(row));

      const fullName = text(row.full_name, 300) || text(
        [text(row.first_name, 150), text(row.last_name, 150)]
          .filter(Boolean)
          .join(' '),
        300
      );
      const linkedIn = text(row.linkedin_url, 1000);
      const email = text(row.email, 500);

      let rawRowId;

      if (existingRawRowId) {
        const claimedRaw = await client.query(
          `
            UPDATE raw_source_rows
            SET processing_status = 'processing'
            WHERE id = $1
              AND import_job_id = $2
              AND processing_status IN ('queued', 'processing')
            RETURNING id
          `,
          [existingRawRowId, importJobId]
        );

        if (claimedRaw.rowCount !== 1) {
          throw new Error(
            `Queued raw row unavailable: ${existingRawRowId}`
          );
        }

        rawRowId = existingRawRowId;
      } else {
        const raw = await client.query(
          `
            INSERT INTO raw_source_rows (
              import_job_id,
              row_number,
              source_record_id,
              row_hash,
              raw_payload,
              processing_status
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5::jsonb,
              'processing'
            )
            RETURNING id
          `,
          [
            importJobId,
            rowNumber,
            sourceRecordId,
            rowHash,
            JSON.stringify(row)
          ]
        );

        rawRowId = raw.rows[0].id;
      }

      // Preserve the original raw payload; invalid identity rows never mutate
      // canonical persons, companies, emails, phones or employment.
      async function rejectIdentity(code, details = {}) {
        rejected++;
        const notes = { code, source_name: sourceName, row_hash: rowHash, ...details };
        await client.query(
          `UPDATE raw_source_rows
           SET processing_status = 'rejected', processing_error = $2,
               resolution_method = 'rejected_identity_validation',
               resolution_notes = $3::jsonb
           WHERE id = $1`,
          [rawRowId, code, JSON.stringify(notes)]
        );
        await client.query(
          `INSERT INTO audit_events(actor, action, entity_type, entity_id, client_id, details)
           VALUES ('lumina-bridge', 'import.identity_validation_rejected',
                   'raw_source_row', $1, $2, $3::jsonb)`,
          [rawRowId, clientId, JSON.stringify({ ...notes, import_job_id: importJobId, row_number: rowNumber })]
        );
        results.push({ row_number: rowNumber, status: 'rejected', reason: code });
      }

      if (row.linkedin_url != null && row.linkedin_url !== '' &&
          !(typeof row.linkedin_url === 'string' && !row.linkedin_url.trim()) &&
          !isPersonLinkedIn(row.linkedin_url)) {
        await rejectIdentity('INVALID_PERSON_LINKEDIN_URL');
        continue;
      }

      // Known aliases are safe to map. Never guess field moves from cell contents.
      const present = value => value != null && String(value).trim() !== '';
      if (present(row.email) && !isContactEmail(row.email)) {
        await rejectIdentity('INVALID_CONTACT_EMAIL');
        continue;
      }
      if (!email && isContactEmail(row.email_1_validation)) {
        await rejectIdentity('MISPLACED_EMAIL_VALUE');
        continue;
      }
      // Preserve the raw row, but require correction before canonical writes.
      if (typeof row.company_name === 'string' &&
          /(?:\?\s*){3,}|\uFFFD/.test(row.company_name)) {
        await rejectIdentity('DAMAGED_COMPANY_NAME_REVIEW_REQUIRED');
        continue;
      }

      if (present(row.company_domain) && !isCompanyDomain(row.company_domain)) {
        await rejectIdentity('INVALID_COMPANY_DOMAIN');
        continue;
      }
      if (present(row.company_website) &&
          (isPersonLinkedIn(row.company_website) || !isCompanyWebsite(row.company_website))) {
        await rejectIdentity('INVALID_COMPANY_WEBSITE');
        continue;
      }

      // Raw payload and hash above retain the exact submitted values.
      // Validate both country fields before identity lookup or canonical writes.
      const countryResult = normalizeCountryFields(row);
      if (countryResult.error) {
        await rejectIdentity(countryResult.error, { field: countryResult.field });
        continue;
      }
      row = countryResult.row;
      if (countryResult.changes.length) {
        await client.query(
          `INSERT INTO audit_events(actor, action, entity_type, entity_id, client_id, details)
           VALUES ('lumina-bridge', 'import.country_normalized',
                   'raw_source_row', $1, $2, $3::jsonb)`,
          [rawRowId, clientId, JSON.stringify({ import_job_id: importJobId,
            row_number: rowNumber, changes: countryResult.changes })]
        );
      }

      // ----------------------------------------------------
      // Suppression gate
      //
      // This runs before any canonical person/company/email
      // or employment mutation.
      // ----------------------------------------------------

      const suppression =
        await findSuppression(
          client,
          {
            row,
            clientId,
            sourceName,
            sourceRecordId
          }
        );

      if (suppression) {
        suppressed++;

        await recordSuppressionHit(
          client,
          {
            suppression,
            rawRowId,
            importJobId,
            rowNumber,
            sourceName,
            sourceRecordId
          }
        );

        results.push({
          row_number: rowNumber,
          status: 'suppressed',
          suppression_id:
            suppression.id,
          suppression_type:
            suppression.type,
          suppression_scope:
            suppression.scope,
          reason:
            suppression.reason
        });

        continue;
      }

      let person = null;
      let matchType = null;

      const identityMatches = [];

      // ----------------------------------------------------
      // Source-record identity
      // ----------------------------------------------------

      if (sourceRecordId) {
        const sourceMatch = await client.query(
          `
            SELECT canonical_person_id
            FROM source_records
            WHERE source_name = $1
              AND source_record_id = $2
            LIMIT 1
          `,
          [sourceName, sourceRecordId]
        );

        if (
          sourceMatch.rowCount > 0 &&
          sourceMatch.rows[0].canonical_person_id
        ) {
          identityMatches.push({
            type: 'source_record',
            person_id:
              sourceMatch.rows[0].canonical_person_id
          });
        }
      }

      // ----------------------------------------------------
      // LinkedIn identity
      // ----------------------------------------------------

      if (linkedIn) {
        const linkedInMatch = await client.query(
          `
            SELECT id
            FROM persons
            WHERE normalized_linkedin_url =
                  lumina_normalize_linkedin($1)
            LIMIT 2
          `,
          [linkedIn]
        );

        if (linkedInMatch.rowCount > 0) {
          for (const matchedPerson of linkedInMatch.rows) {
            identityMatches.push({ type: 'linkedin', person_id: matchedPerson.id });
          }
        }
      }

      // ----------------------------------------------------
      // Email identity
      // ----------------------------------------------------

      if (email) {
        const emailMatches = await client.query(
          `
            SELECT DISTINCT p.id
            FROM persons p
            JOIN emails e
              ON e.person_id = p.id
            WHERE e.normalized_email =
                  lumina_normalize_email($1)
            LIMIT 10
          `,
          [email]
        );

        for (const row of emailMatches.rows) {
          identityMatches.push({
            type: 'email',
            person_id: row.id
          });
        }
      }

      const distinctPersonIds = [
        ...new Set(
          identityMatches.map(
            match => match.person_id
          )
        )
      ];

      // ----------------------------------------------------
      // Strong identity disagreement
      // ----------------------------------------------------

      if (distinctPersonIds.length > 1) {
        conflicts++;

        const sourceIdentity =
          identityMatches.find(
            match => match.type === 'source_record'
          );

        const conflictAnchorId =
          sourceIdentity?.person_id ||
          distinctPersonIds[0];

        const evidence = {
          source_name: sourceName,
          source_record_id: sourceRecordId,
          linkedin_url: linkedIn,
          email,
          matches: identityMatches,
          candidate_person_ids: distinctPersonIds,
          row_hash: rowHash
        };

        const conflictResult =
          await client.query(
            `
              INSERT INTO conflicts (
                entity_type,
                entity_id,
                field_name,
                existing_value,
                incoming_value,
                source_name,
                source_record_id,
                status,
                import_job_id,
                raw_source_row_id,
                conflict_type,
                candidate_person_ids,
                evidence
              )
              VALUES (
                'person',
                $1,
                'strong_identity',
                $2,
                $3,
                $4,
                $5,
                'open',
                $6,
                $7,
                'strong_identity_disagreement',
                $8::uuid[],
                $9::jsonb
              )
              RETURNING id
            `,
            [
              conflictAnchorId,
              JSON.stringify(identityMatches),
              JSON.stringify({
                source_record_id: sourceRecordId,
                linkedin_url: linkedIn,
                email
              }),
              sourceName,
              sourceRecordId,
              importJobId,
              rawRowId,
              distinctPersonIds,
              JSON.stringify(evidence)
            ]
          );

        const conflictId =
          conflictResult.rows[0].id;

        await client.query(
          `
            UPDATE raw_source_rows
            SET
              processing_status = 'conflict',
              processing_error =
                'Strong identity disagreement',
              resolution_method =
                'conflict_strong_identity',
              resolution_score = 0,
              resolution_notes = $2::jsonb
            WHERE id = $1
          `,
          [
            rawRowId,
            JSON.stringify({
              conflict_id: conflictId,
              ...evidence
            })
          ]
        );

        await client.query(
          `
            INSERT INTO audit_events (
              actor,
              action,
              entity_type,
              entity_id,
              details
            )
            VALUES (
              'lumina-bridge',
              'person.identity_conflict',
              'person',
              $1,
              $2::jsonb
            )
          `,
          [
            conflictAnchorId,
            JSON.stringify({
              conflict_id: conflictId,
              import_job_id: importJobId,
              raw_source_row_id: rawRowId,
              candidate_person_ids:
                distinctPersonIds,
              evidence
            })
          ]
        );

        results.push({
          row_number: rowNumber,
          status: 'conflict',
          conflict_id: conflictId,
          candidate_person_ids:
            distinctPersonIds
        });

        continue;
      }

      // ----------------------------------------------------
      // Exactly one strong identity matched
      // ----------------------------------------------------

      if (distinctPersonIds.length === 1) {
        person = {
          id: distinctPersonIds[0]
        };

        const chosenMatches =
          identityMatches.filter(
            match =>
              match.person_id === person.id
          );

        if (
          chosenMatches.some(
            match =>
              match.type === 'source_record'
          )
        ) {
          matchType = 'source_record';
        } else if (
          chosenMatches.some(
            match =>
              match.type === 'linkedin'
          )
        ) {
          matchType = 'linkedin';
        } else {
          matchType = 'email';
        }
      }

      if (person) {
        // Earlier imports may have attached several emails to one person through
        // a company domain used as LinkedIn. Do not silently reuse that person.
        const history = await client.query(
          `SELECT linkedin_url, NULL::text AS email FROM persons WHERE id = $1
           UNION ALL
           SELECT raw_payload->>'linkedin_url' AS linkedin_url, raw_payload->>'email' AS email
           FROM raw_source_rows
           WHERE canonical_person_id = $1
             AND resolution_method IN ('linkedin', 'new_person', 'email', 'source_record')`,
          [person.id]
        );
        if (history.rows.some(item =>
          (item.linkedin_url?.trim() && !isPersonLinkedIn(item.linkedin_url)) ||
          (item.email?.trim() && !isContactEmail(item.email)))) {
          await rejectIdentity('PERSON_IDENTITY_REVIEW_REQUIRED', { candidate_person_id: person.id });
          continue;
        }
      }

      // ----------------------------------------------------
      // No strong match and no usable identity
      // ----------------------------------------------------

      if (
        !person &&
        !fullName &&
        !linkedIn &&
        !email
      ) {
        rejected++;

        await client.query(
          `
            UPDATE raw_source_rows
            SET
              processing_status = 'rejected',
              processing_error =
                'No usable person identity',
              resolution_method =
                'rejected_no_identity',
              resolution_notes = $2::jsonb
            WHERE id = $1
          `,
          [
            rawRowId,
            JSON.stringify({
              source_name: sourceName,
              source_record_id:
                sourceRecordId,
              row_hash: rowHash
            })
          ]
        );

        await client.query(
          `
            INSERT INTO audit_events (
              actor,
              action,
              entity_type,
              entity_id,
              client_id,
              details
            )
            VALUES (
              'lumina-bridge',
              'import.row_rejected',
              'raw_source_row',
              $1,
              $2,
              $3::jsonb
            )
          `,
          [
            rawRowId,
            clientId,
            JSON.stringify({
              import_job_id: importJobId,
              row_number: rowNumber,
              reason: 'No usable person identity',
              resolution_method:
                'rejected_no_identity',
              source_name: sourceName,
              source_record_id:
                sourceRecordId
            })
          ]
        );

        results.push({
          row_number: rowNumber,
          status: 'rejected',
          reason:
            'No usable person identity'
        });

        continue;
      }

      const companyResolution =
        await resolveCompany(
          client,
          {
            row,
            sourceName,
            sourceRecordId,
            importJobId,
            rawRowId,
            rowHash
          }
        );

      if (
        companyResolution.status ===
        'conflict'
      ) {
        conflicts++;

        results.push({
          row_number: rowNumber,
          status: 'conflict',
          conflict_id:
            companyResolution.conflictId,
          conflict_type:
            'company_identity',
          candidate_company_ids:
            companyResolution
              .candidateCompanyIds
        });

        continue;
      }

      const companyId =
        companyResolution.companyId || null;

      const companyFieldPolicyResolution =
        companyResolution.fieldPolicyResolution || {
          decisions: {},
          updates: {},
          summary: {},
          hasConflict: false
        };

      const companyCanonicalChanged =
        Boolean(
          companyResolution
            .companyCanonicalChanged
        );

      const personWasExisting =
        Boolean(person);

      const incomingPersonFields = {
        current_title:
          text(row.current_title, 300),
        department:
          text(row.department, 150),
        seniority:
          text(row.seniority, 100)
      };

      let fieldPolicyResolution = {
        decisions: {},
        updates: {},
        summary: {},
        hasConflict: false
      };

      let personCanonicalChanged = false;

      let duplicateCandidateResolution = {
        status: personWasExisting
          ? 'skipped_existing_person'
          : 'not_run',
        evaluated: 0,
        qualified: 0,
        created: 0,
        candidates: []
      };

      if (person) {

        // --------------------------------------------------
        // Revision 12:
        // Lock and inspect the actual canonical Person row
        // before making field-level decisions.
        // --------------------------------------------------

        const existingPersonFields =
          await client.query(
            `
              SELECT
                full_name,
                first_name,
                last_name,
                current_title,
                department,
                seniority,
                contact_city,
                contact_country,
                linkedin_url
              FROM persons
              WHERE id = $1
              FOR UPDATE
            `,
            [person.id]
          );

        if (
          existingPersonFields.rowCount !== 1
        ) {
          throw new Error(
            `Canonical person not found: ${person.id}`
          );
        }

        fieldPolicyResolution =
          await evaluatePersonFieldPolicies(
            client,
            {
              personId: person.id,
              existingValues:
                existingPersonFields.rows[0],
              incomingValues:
                incomingPersonFields,
              sourceName,
              sourceRecordId,
              importJobId,
              rawRowId
            }
          );

        const personUpdate =
          await client.query(
          `
            UPDATE persons
            SET
              full_name =
                COALESCE($2, full_name),
              first_name =
                COALESCE($3, first_name),
              last_name =
                COALESCE($4, last_name),

              current_title =
                COALESCE(
                  $5,
                  current_title
                ),

              department =
                COALESCE(
                  $6,
                  department
                ),

              seniority =
                COALESCE(
                  $7,
                  seniority
                ),

              contact_city =
                COALESCE(
                  $8,
                  contact_city
                ),

              contact_country =
                COALESCE(
                  $9,
                  contact_country
                ),

              linkedin_url =
                COALESCE(
                  $10,
                  linkedin_url
                ),

              updated_at = NOW()

            WHERE id = $1
              AND (
                full_name IS DISTINCT FROM
                  COALESCE($2, full_name)
                OR
                first_name IS DISTINCT FROM
                  COALESCE($3, first_name)
                OR
                last_name IS DISTINCT FROM
                  COALESCE($4, last_name)
                OR
                current_title IS DISTINCT FROM
                  COALESCE($5, current_title)
                OR
                department IS DISTINCT FROM
                  COALESCE($6, department)
                OR
                seniority IS DISTINCT FROM
                  COALESCE($7, seniority)
                OR
                contact_city IS DISTINCT FROM
                  COALESCE($8, contact_city)
                OR
                contact_country IS DISTINCT FROM
                  COALESCE($9, contact_country)
                OR
                linkedin_url IS DISTINCT FROM
                  COALESCE($10, linkedin_url)
              )
            RETURNING id
          `,
          [
            person.id,
            fullName,
            text(row.first_name, 150),
            text(row.last_name, 150),

            fieldPolicyResolution
              .updates.current_title ?? null,

            fieldPolicyResolution
              .updates.department ?? null,

            fieldPolicyResolution
              .updates.seniority ?? null,

            text(row.contact_city, 150),
            text(row.contact_country, 150),
            linkedIn
          ]
        );

        if (personUpdate.rowCount > 0) {
          personCanonicalChanged = true;
        }

      } else {
        const created = await client.query(
          `
            INSERT INTO persons (
              full_name,
              first_name,
              last_name,
              current_title,
              department,
              seniority,
              contact_city,
              contact_country,
              linkedin_url,
              metadata
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,
              '{"source":"import","environment":"staging"}'::jsonb
            )
            RETURNING id
          `,
          [
            fullName,
            text(row.first_name, 150),
            text(row.last_name, 150),

            incomingPersonFields
              .current_title,

            incomingPersonFields
              .department,

            incomingPersonFields
              .seniority,

            text(row.contact_city, 150),
            text(row.contact_country, 150),
            linkedIn
          ]
        );

        person = created.rows[0];
        inserted++;
        personCanonicalChanged = true;

        // --------------------------------------------------
        // A brand-new Person has no prior canonical owner.
        //
        // The physical row was just created from this same
        // source, so existingValues are deliberately null.
        // This initializes provenance under the actual source
        // rather than incorrectly calling it legacy data.
        // --------------------------------------------------

        fieldPolicyResolution =
          await evaluatePersonFieldPolicies(
            client,
            {
              personId: person.id,
              existingValues: {
                current_title: null,
                department: null,
                seniority: null
              },
              incomingValues:
                incomingPersonFields,
              sourceName,
              sourceRecordId,
              importJobId,
              rawRowId
            }
          );
      }

      // conflict_rows counts a row once even when both
      // Person and Company contain field-level conflicts.
      const rowHasFieldConflict =
        fieldPolicyResolution.hasConflict ||
        companyFieldPolicyResolution.hasConflict;

      if (rowHasFieldConflict) {
        conflicts++;
      }

      const rowCanonicalChanged =
        personCanonicalChanged ||
        companyCanonicalChanged;

      // Existing-Person imports count as one updated row when
      // either the Person or its resolved Company changed.
      if (
        personWasExisting &&
        rowCanonicalChanged
      ) {
        updated++;
      } else if (
        personWasExisting &&
        !rowCanonicalChanged
      ) {
        matched++;
      }

      if (email) {
        await client.query(
          `
            INSERT INTO emails (
              person_id,
              email,
              is_primary,
              source_name
            )
            VALUES ($1,$2,true,$3)
            ON CONFLICT (person_id, email)
            DO NOTHING
          `,
          [person.id, email, sourceName]
        );
      }

      const phoneResolution =
        await upsertPhones(
          client,
          {
            personId: person.id,
            companyId,
            row,
            sourceName,
            importJobId
          }
        );

      if (companyId) {
        await upsertEmployment(
          client,
          {
            personId: person.id,
            companyId,
            row,
            sourceName,
            importJobId
          }
        );
      }

      // ----------------------------------------------------
      // Revision 13:
      // Review-only fuzzy duplicate candidate detection.
      //
      // Deterministic source-record / LinkedIn / email
      // matching remains authoritative. Only a newly-created
      // canonical Person reaches this scorer.
      //
      // This is advisory intelligence. A scorer failure must
      // not invalidate an otherwise-valid canonical import.
      // ----------------------------------------------------

      if (!personWasExisting) {
        await client.query(
          'SAVEPOINT duplicate_candidate_scoring'
        );

        try {
          duplicateCandidateResolution =
            await findAndStoreDuplicateCandidates(
              client,
              {
                personId: person.id,
                importJobId,
                rawRowId
              }
            );

          duplicateCandidateResolution = {
            status: 'completed',
            ...duplicateCandidateResolution
          };

          await client.query(
            'RELEASE SAVEPOINT duplicate_candidate_scoring'
          );
        } catch (error) {
          await client.query(
            'ROLLBACK TO SAVEPOINT duplicate_candidate_scoring'
          );

          await client.query(
            'RELEASE SAVEPOINT duplicate_candidate_scoring'
          );

          console.error(
            'Revision 13 duplicate candidate scoring failed',
            {
              person_id: person.id,
              import_job_id: importJobId,
              raw_source_row_id: rawRowId,
              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            }
          );

          duplicateCandidateResolution = {
            status: 'scoring_failed',
            evaluated: 0,
            qualified: 0,
            created: 0,
            candidates: []
          };
        }
      }

      if (sourceRecordId) {
        await client.query(
          `
            INSERT INTO source_records (
              source_name,
              source_record_id,
              canonical_person_id,
              canonical_company_id,
              last_import_job_id,
              last_raw_source_row_id,
              payload_hash,
              metadata
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8::jsonb
            )
            ON CONFLICT (
              source_name,
              source_record_id
            )
            DO UPDATE SET
              canonical_person_id =
                EXCLUDED.canonical_person_id,
              canonical_company_id =
                COALESCE(
                  EXCLUDED.canonical_company_id,
                  source_records.canonical_company_id
                ),
              last_import_job_id =
                EXCLUDED.last_import_job_id,
              last_raw_source_row_id =
                EXCLUDED.last_raw_source_row_id,
              payload_hash =
                EXCLUDED.payload_hash,
              metadata =
                source_records.metadata ||
                EXCLUDED.metadata,
              last_seen_at = NOW()
          `,
          [
            sourceName,
            sourceRecordId,
            person.id,
            companyId,
            importJobId,
            rawRowId,
            rowHash,
            JSON.stringify({
              last_resolution_method:
                matchType || 'new_person'
            })
          ]
        );
      }

      await client.query(
        `
          UPDATE raw_source_rows
          SET
            processing_status = 'processed',
            canonical_person_id = $2,
            canonical_company_id = $3,
            resolution_method = $4,
            resolution_score = $5,
            resolution_notes = $6::jsonb
          WHERE id = $1
        `,
        [
          rawRowId,
          person.id,
          companyId,
          matchType || 'new_person',
          matchType ? 100 : null,
          JSON.stringify({
            source_name: sourceName,
            source_record_id: sourceRecordId,
            row_hash: rowHash,
            company_id: companyId,
            company_resolution:
              companyResolution.matchType || null,
            company_created:
              companyResolution.created || false,
            company_canonical_changed:
              companyCanonicalChanged,
            company_field_policy:
              companyFieldPolicyResolution.summary,
            person_phone_count:
              phoneResolution.personPhones.length,
            company_phone_count:
              phoneResolution.companyPhones.length,
            field_policy:
              fieldPolicyResolution.summary,
            duplicate_candidate_resolution:
              duplicateCandidateResolution
          })
        ]
      );

      await client.query(
        `
          INSERT INTO audit_events (
            actor,
            action,
            entity_type,
            entity_id,
            details
          )
          VALUES (
            'lumina-bridge',
            $1,
            'person',
            $2,
            $3::jsonb
          )
        `,
        [
          matchType
            ? (
                personCanonicalChanged
                  ? 'person.import_updated'
                  : 'person.import_matched'
              )
            : 'person.import_created',
          person.id,
          JSON.stringify({
            import_job_id: importJobId,
            row_number: rowNumber,
            match_type: matchType,
            canonical_changed:
              personCanonicalChanged,
            field_policy:
              fieldPolicyResolution.summary,
            duplicate_candidate_resolution:
              duplicateCandidateResolution
          })
        ]
      );

      results.push({
        row_number: rowNumber,
        status:
          matchType
            ? (
                rowCanonicalChanged
                  ? 'updated'
                  : 'matched'
              )
            : 'inserted',
        person_id: person.id,
        match_type: matchType,
        canonical_changed:
          rowCanonicalChanged,
        person_canonical_changed:
          personCanonicalChanged,
        company_canonical_changed:
          companyCanonicalChanged,
        field_policy:
          fieldPolicyResolution.summary,
        company_field_policy:
          companyFieldPolicyResolution.summary,
        has_field_conflict:
          rowHasFieldConflict,
        duplicate_candidate_resolution:
          duplicateCandidateResolution
      });
    }

    return {
      inserted,
      updated,
      matched,
      duplicates,
      rejected,
      conflicts,
      suppressed,
      results
    };
  }

  const TASKS_LOCATION =
    process.env.LUMINA_TASKS_LOCATION ||
    'asia-southeast1';

  const TASKS_QUEUE =
    process.env.LUMINA_TASKS_QUEUE ||
    'lumina-imports';

  const TASKS_PROJECT =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    'lumina-staging-509411';

  const TASKS_SERVICE_URL =
    String(
      process.env.LUMINA_SERVICE_URL || ''
    ).replace(/\/$/, '');

  const TASKS_OIDC_SERVICE_ACCOUNT =
    process.env.LUMINA_TASKS_OIDC_SERVICE_ACCOUNT ||
    'lumina-bridge@lumina-staging-509411.iam.gserviceaccount.com';

  const TASKS_OIDC_AUDIENCE =
    process.env.LUMINA_TASKS_OIDC_AUDIENCE ||
    TASKS_SERVICE_URL;

  async function metadataAccessToken() {
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: {
          'Metadata-Flavor': 'Google'
        }
      }
    );

    if (!response.ok) {
      const error = new Error(
        'CLOUD_TASKS_ACCESS_TOKEN_FAILED'
      );
      error.code =
        'CLOUD_TASKS_ACCESS_TOKEN_FAILED';
      throw error;
    }

    const payload = await response.json();

    if (!payload?.access_token) {
      const error = new Error(
        'CLOUD_TASKS_ACCESS_TOKEN_MISSING'
      );
      error.code =
        'CLOUD_TASKS_ACCESS_TOKEN_MISSING';
      throw error;
    }

    return payload.access_token;
  }

  async function enqueueImportTask(importJobId) {
    if (!TASKS_SERVICE_URL) {
      const error = new Error(
        'LUMINA_SERVICE_URL_REQUIRED'
      );
      error.code = 'LUMINA_SERVICE_URL_REQUIRED';
      throw error;
    }

    const accessToken =
      await metadataAccessToken();

    const parent =
      `projects/${TASKS_PROJECT}` +
      `/locations/${TASKS_LOCATION}` +
      `/queues/${TASKS_QUEUE}`;

    const taskUrl =
      `${TASKS_SERVICE_URL}` +
      `/internal/import-jobs/` +
      `${importJobId}/process`;

    const response = await fetch(
      `https://cloudtasks.googleapis.com/v2/${parent}/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          task: {
            httpRequest: {
              httpMethod: 'POST',
              url: taskUrl,
              headers: {
                'Content-Type':
                  'application/json'
              },
              oidcToken: {
                serviceAccountEmail:
                  TASKS_OIDC_SERVICE_ACCOUNT,
                audience:
                  TASKS_OIDC_AUDIENCE
              },
              body:
                Buffer.from(
                  JSON.stringify({
                    import_job_id:
                      importJobId
                  })
                ).toString('base64')
            }
          }
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(
        `CLOUD_TASKS_ENQUEUE_FAILED:${response.status}`
      );
      error.code =
        'CLOUD_TASKS_ENQUEUE_FAILED';
      error.details = body.slice(0, 1000);
      throw error;
    }

    return await response.json();
  }

  function buildRequestHash(
    {
      filename,
      sourceName,
      clientId,
      rows
    }
  ) {
    return sha256(
      JSON.stringify(
        clientId
          ? {
              filename,
              sourceName,
              clientId,
              rows
            }
          : {
              filename,
              sourceName,
              rows
            }
      )
    );
  }

  async function createQueuedImportJob(
    {
      rows,
      filename,
      sourceName,
      clientId,
      idempotencyKey,
      inputType,
      fileImportMeta
    }
  ) {
    const requestHash =
      buildRequestHash({
        filename,
        sourceName,
        clientId,
        rows
      });

    const client = await pool.connect();
    let advisoryLockHeld = false;
    let importJobId = null;

    try {
      await client.query('BEGIN');

      await client.query(
        `
          SELECT pg_advisory_lock(
            hashtext($1)
          )
        `,
        [`${clientId}:${idempotencyKey}`]
      );

      advisoryLockHeld = true;

      const prior = await client.query(
        `
          SELECT
            id,
            request_hash,
            status,
            total_rows,
            processed_rows,
            inserted_rows,
            updated_rows,
            matched_rows,
            duplicate_rows,
            rejected_rows,
            conflict_rows,
            suppressed_rows
          FROM import_jobs
          WHERE client_id = $1
            AND idempotency_key = $2
          LIMIT 1
        `,
        [clientId, idempotencyKey]
      );

      if (prior.rowCount > 0) {
        const existing = prior.rows[0];

        if (
          existing.request_hash &&
          existing.request_hash !== requestHash
        ) {
          await client.query('ROLLBACK');

          return {
            httpStatus: 409,
            body: {
              status: 'error',
              code:
                'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
              import_job_id: existing.id
            }
          };
        }

        await client.query('COMMIT');

        if (existing.status === 'completed') {
          return {
            httpStatus: 200,
            body: {
              status: 'ok',
              replayed: true,
              import_job_id: existing.id,
              summary: {
                total: existing.total_rows,
                processed:
                  existing.processed_rows,
                inserted:
                  existing.inserted_rows,
                updated:
                  existing.updated_rows,
                matched:
                  existing.matched_rows,
                duplicates:
                  existing.duplicate_rows,
                rejected:
                  existing.rejected_rows,
                conflicts:
                  existing.conflict_rows,
                suppressed:
                  existing.suppressed_rows
              }
            }
          };
        }

        if (
          existing.status === 'queued' ||
          existing.status === 'processing'
        ) {
          return {
            httpStatus: 202,
            body: {
              status: existing.status,
              replayed: true,
              import_job_id: existing.id,
              progress: {
                total: existing.total_rows,
                processed:
                  existing.processed_rows
              }
            }
          };
        }

        if (existing.status === 'failed') {
          return {
            httpStatus: 409,
            body: {
              status: 'error',
              replayed: true,
              code:
                'IDEMPOTENT_IMPORT_PREVIOUSLY_FAILED',
              import_job_id: existing.id,
              message:
                'This idempotency key belongs to a failed import. Retry the job or use a new idempotency key.'
            }
          };
        }

        return {
          httpStatus: 409,
          body: {
            status: 'error',
            replayed: true,
            code: 'IMPORT_JOB_NOT_REPLAYABLE',
            import_job_id: existing.id,
            import_status: existing.status
          }
        };
      }

      if (clientId) {
        const clientCheck = await client.query(
          `
            SELECT id
            FROM clients
            WHERE id = $1
            LIMIT 1
          `,
          [clientId]
        );

        if (clientCheck.rowCount === 0) {
          await client.query('ROLLBACK');
          return {
            httpStatus: 400,
            body: {
              status: 'error',
              code: 'CLIENT_NOT_FOUND'
            }
          };
        }
      }

      const metadata = {
        environment: 'staging',
        input_type: inputType,
        async: true,
        chunk_rows:
          ASYNC_IMPORT_CHUNK_ROWS,
        ...(fileImportMeta
          ? { file_import: fileImportMeta }
          : {})
      };

      const job = await client.query(
        `
          INSERT INTO import_jobs (
            filename,
            source_name,
            client_id,
            status,
            total_rows,
            started_at,
            created_by,
            idempotency_key,
            request_hash,
            metadata
          )
          VALUES (
            $1,
            $2,
            $3,
            'queued',
            $4,
            NOW(),
            'lumina-bridge',
            $5,
            $6,
            $7::jsonb
          )
          RETURNING id
        `,
        [
          filename,
          sourceName,
          clientId,
          rows.length,
          idempotencyKey,
          requestHash,
          JSON.stringify(metadata)
        ]
      );

      importJobId = job.rows[0].id;

      const queuedRows = rows.map(
        (row, index) => ({
          row_number: index + 1,
          source_record_id:
            text(row?.source_record_id, 500),
          row_hash:
            sha256(JSON.stringify(row || {})),
          raw_payload: row || {}
        })
      );

      await client.query(
        `
          INSERT INTO raw_source_rows (
            import_job_id,
            row_number,
            source_record_id,
            row_hash,
            raw_payload,
            processing_status
          )
          SELECT
            $1,
            q.row_number,
            q.source_record_id,
            q.row_hash,
            q.raw_payload,
            'queued'
          FROM jsonb_to_recordset(
            $2::jsonb
          ) AS q(
            row_number integer,
            source_record_id text,
            row_hash text,
            raw_payload jsonb
          )
          ORDER BY q.row_number
        `,
        [
          importJobId,
          JSON.stringify(queuedRows)
        ]
      );

      await client.query(
        `
          INSERT INTO audit_events (
            actor,
            action,
            entity_type,
            entity_id,
            client_id,
            details
          )
          VALUES (
            'lumina-bridge',
            'import.queued',
            'import_job',
            $1,
            $2,
            $3::jsonb
          )
        `,
        [
          importJobId,
          clientId,
          JSON.stringify({
            total: rows.length,
            input_type: inputType,
            chunk_rows:
              ASYNC_IMPORT_CHUNK_ROWS
          })
        ]
      );

      await client.query('COMMIT');

      try {
        await enqueueImportTask(importJobId);
      } catch (enqueueError) {
        await client.query('BEGIN');

        await client.query(
          `
            UPDATE import_jobs
            SET
              status = 'failed',
              completed_at = NOW(),
              result_summary = $2::jsonb
            WHERE id = $1
          `,
          [
            importJobId,
            JSON.stringify({
              status: 'failed',
              code:
                'TASK_ENQUEUE_FAILED',
              error_code:
                enqueueError?.code || null
            })
          ]
        );

        await client.query(
          `
            INSERT INTO audit_events (
              actor,
              action,
              entity_type,
              entity_id,
              client_id,
              details
            )
            VALUES (
              'lumina-bridge',
              'import.failed',
              'import_job',
              $1,
              $2,
              $3::jsonb
            )
          `,
          [
            importJobId,
            clientId,
            JSON.stringify({
              code:
                'TASK_ENQUEUE_FAILED',
              error_code:
                enqueueError?.code || null
            })
          ]
        );

        await client.query('COMMIT');
        throw enqueueError;
      }

      return {
        httpStatus: 202,
        body: {
          status: 'queued',
          import_job_id: importJobId,
          progress: {
            total: rows.length,
            processed: 0,
            percent: 0
          },
          chunk_rows:
            ASYNC_IMPORT_CHUNK_ROWS
        }
      };

    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw error;

    } finally {
      if (advisoryLockHeld) {
        try {
          await client.query(
            `
              SELECT pg_advisory_unlock(
                hashtext($1)
              )
            `,
            [`${clientId}:${idempotencyKey}`]
          );
        } catch {}
      }

      client.release();
    }
  }

  async function processAsyncImportJob(
    importJobId,
    retryCount = 0
  ) {
    const client = await pool.connect();
    let workerLockHeld = false;

    async function releaseWorkerLock() {
      if (!workerLockHeld) {
        return;
      }

      await client.query(
        `
          SELECT pg_advisory_unlock(
            hashtext($1)
          )
        `,
        [`import-worker:${importJobId}`]
      );

      workerLockHeld = false;
    }

    try {
      const lockResult = await client.query(
        `
          SELECT pg_try_advisory_lock(
            hashtext($1)
          ) AS locked
        `,
        [`import-worker:${importJobId}`]
      );

      if (!lockResult.rows[0]?.locked) {
        return {
          status: 'busy'
        };
      }

      workerLockHeld = true;

      await client.query('BEGIN');

      const jobResult = await client.query(
        `
          SELECT
            id,
            source_name,
            client_id,
            status,
            total_rows,
            processed_rows,
            inserted_rows,
            updated_rows,
            matched_rows,
            duplicate_rows,
            rejected_rows,
            conflict_rows,
            suppressed_rows
          FROM import_jobs
          WHERE id = $1
          FOR UPDATE
        `,
        [importJobId]
      );

      if (jobResult.rowCount !== 1) {
        await client.query('COMMIT');
        return { status: 'not_found' };
      }

      const job = jobResult.rows[0];

      if (job.status === 'completed') {
        await client.query('COMMIT');
        return { status: 'completed' };
      }

      if (job.status === 'failed') {
        await client.query('COMMIT');
        return { status: 'failed' };
      }

      await client.query(
        `
          UPDATE import_jobs
          SET status = 'processing'
          WHERE id = $1
        `,
        [importJobId]
      );

      const queued = await client.query(
        `
          SELECT
            id,
            row_number,
            raw_payload
          FROM raw_source_rows
          WHERE import_job_id = $1
            AND processing_status = 'queued'
          ORDER BY row_number
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        `,
        [
          importJobId,
          ASYNC_IMPORT_CHUNK_ROWS
        ]
      );

      if (queued.rowCount === 0) {
        const current = await client.query(
          `
            SELECT
              total_rows,
              processed_rows,
              inserted_rows,
              updated_rows,
              matched_rows,
              duplicate_rows,
              rejected_rows,
              conflict_rows,
              suppressed_rows
            FROM import_jobs
            WHERE id = $1
          `,
          [importJobId]
        );

        const state = current.rows[0];

        if (
          Number(state.processed_rows) >=
          Number(state.total_rows)
        ) {
          const summary = {
            total: Number(state.total_rows),
            inserted:
              Number(state.inserted_rows),
            updated:
              Number(state.updated_rows),
            matched:
              Number(state.matched_rows),
            duplicates:
              Number(state.duplicate_rows),
            rejected:
              Number(state.rejected_rows),
            conflicts:
              Number(state.conflict_rows),
            suppressed:
              Number(state.suppressed_rows)
          };

          await client.query(
            `
              UPDATE import_jobs
              SET
                status = 'completed',
                completed_at = NOW(),
                result_summary = $2::jsonb
              WHERE id = $1
            `,
            [
              importJobId,
              JSON.stringify(summary)
            ]
          );

          await client.query(
            `
              INSERT INTO audit_events (
                actor,
                action,
                entity_type,
                entity_id,
                client_id,
                details
              )
              VALUES (
                'lumina-bridge',
                'import.completed',
                'import_job',
                $1,
                $2,
                $3::jsonb
              )
            `,
            [
              importJobId,
              job.client_id,
              JSON.stringify(summary)
            ]
          );

          await client.query('COMMIT');
          return {
            status: 'completed',
            summary
          };
        }

        await client.query('COMMIT');

        // Release this worker before creating its successor.
        // Otherwise the next Cloud Task can dispatch immediately,
        // see the advisory lock as busy, and be consumed.
        await releaseWorkerLock();

        await enqueueImportTask(importJobId);

        return { status: 'requeued' };
      }

      const rows = queued.rows.map(
        raw => ({
          __lumina_raw_row_id: raw.id,
          __lumina_row_number:
            raw.row_number,
          __lumina_payload:
            raw.raw_payload || {}
        })
      );

      const chunk = await processImportRows(
        client,
        {
          rows,
          importJobId,
          clientId: job.client_id,
          sourceName: job.source_name
        }
      );

      const nextProcessed =
        Number(job.processed_rows) +
        rows.length;

      const nextSummary = {
        total: Number(job.total_rows),
        processed: nextProcessed,
        inserted:
          Number(job.inserted_rows) +
          chunk.inserted,
        updated:
          Number(job.updated_rows) +
          chunk.updated,
        matched:
          Number(job.matched_rows) +
          chunk.matched,
        duplicates:
          Number(job.duplicate_rows) +
          chunk.duplicates,
        rejected:
          Number(job.rejected_rows) +
          chunk.rejected,
        conflicts:
          Number(job.conflict_rows) +
          chunk.conflicts,
        suppressed:
          Number(job.suppressed_rows) +
          chunk.suppressed
      };

      const completed =
        nextProcessed >= Number(job.total_rows);

      await client.query(
        `
          UPDATE import_jobs
          SET
            status = $2,
            processed_rows = $3,
            inserted_rows = $4,
            updated_rows = $5,
            matched_rows = $6,
            duplicate_rows = $7,
            rejected_rows = $8,
            conflict_rows = $9,
            suppressed_rows = $10,
            completed_at =
              CASE
                WHEN $2 = 'completed'
                THEN NOW()
                ELSE completed_at
              END,
            result_summary = $11::jsonb
          WHERE id = $1
        `,
        [
          importJobId,
          completed
            ? 'completed'
            : 'processing',
          nextSummary.processed,
          nextSummary.inserted,
          nextSummary.updated,
            nextSummary.matched,
          nextSummary.duplicates,
          nextSummary.rejected,
          nextSummary.conflicts,
          nextSummary.suppressed,
          JSON.stringify(nextSummary)
        ]
      );

      if (completed) {
        await client.query(
          `
            INSERT INTO audit_events (
              actor,
              action,
              entity_type,
              entity_id,
              client_id,
              details
            )
            VALUES (
              'lumina-bridge',
              'import.completed',
              'import_job',
              $1,
              $2,
              $3::jsonb
            )
          `,
          [
            importJobId,
            job.client_id,
            JSON.stringify(nextSummary)
          ]
        );
      }

      await client.query('COMMIT');

      if (!completed) {
        // Handoff only after this worker no longer owns the
        // per-job advisory lock.
        await releaseWorkerLock();

        await enqueueImportTask(importJobId);
      }

      return {
        status:
          completed
            ? 'completed'
            : 'processing',
        summary: nextSummary
      };

    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}

      if (retryCount >= 4) {
        try {
          await client.query('BEGIN');

          const failedJob = await client.query(
            `
              UPDATE import_jobs
              SET
                status = 'failed',
                completed_at = NOW(),
                result_summary = $2::jsonb
              WHERE id = $1
                AND status <> 'completed'
              RETURNING client_id
            `,
            [
              importJobId,
              JSON.stringify({
                status: 'failed',
                code:
                  'ASYNC_IMPORT_FAILED',
                error_code:
                  error?.code || null,
                retry_count: retryCount
              })
            ]
          );

          if (failedJob.rowCount === 1) {
            await client.query(
              `
                INSERT INTO audit_events (
                  actor,
                  action,
                  entity_type,
                  entity_id,
                  client_id,
                  details
                )
                VALUES (
                  'lumina-bridge',
                  'import.failed',
                  'import_job',
                  $1,
                  $2,
                  $3::jsonb
                )
              `,
              [
                importJobId,
                failedJob.rows[0].client_id,
                JSON.stringify({
                  code:
                    'ASYNC_IMPORT_FAILED',
                  error_code:
                    error?.code || null,
                  retry_count:
                    retryCount
                })
              ]
            );
          }

          await client.query('COMMIT');
        } catch (recordFailureError) {
          try {
            await client.query('ROLLBACK');
          } catch {}

          console.error(
            'Failed to persist async import failure:',
            recordFailureError
          );
        }

        return {
          status: 'failed',
          terminal: true
        };
      }

      throw error;

    } finally {
      if (workerLockHeld) {
        try {
          await client.query(
            `
              SELECT pg_advisory_unlock(
                hashtext($1)
              )
            `,
            [`import-worker:${importJobId}`]
          );
        } catch {}
      }

      client.release();
    }
  }

  async function queueParsedFileImport(
    req,
    parsed
  ) {
    const filename =
      text(req.file?.originalname, 500) ||
      'file-import';

    const sourceName =
      text(req.body?.source_name, 200) ||
      'file-upload';

    const suppliedClientId =
      text(req.body?.client_id, 100);

    const clientId = req.auth?.clientId || null;

    if (!clientId) {
      return {
        httpStatus: 401,
        body: { status: 'error', code: 'AUTH_CONTEXT_REQUIRED' }
      };
    }

    if (suppliedClientId && suppliedClientId !== clientId) {
      return {
        httpStatus: 403,
        body: { status: 'error', code: 'CLIENT_SCOPE_MISMATCH' }
      };
    }

    const idempotencyKey =
      text(req.body?.idempotency_key, 300);

    if (!idempotencyKey) {
      return {
        httpStatus: 400,
        body: {
          status: 'error',
          code:
            'IDEMPOTENCY_KEY_REQUIRED'
        }
      };
    }

    if (clientId && !isUuid(clientId)) {
      return {
        httpStatus: 400,
        body: {
          status: 'error',
          code: 'INVALID_CLIENT_ID'
        }
      };
    }

    return await createQueuedImportJob({
      rows: parsed.rows,
      filename,
      sourceName,
      clientId,
      idempotencyKey,
      inputType: parsed.inputType,
      fileImportMeta:
        req.luminaFileImportMeta
    });
  }

  const handleImport = async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const filename = text(req.body?.filename, 500) || 'json-import';
    const sourceName = text(req.body?.source_name, 200) || 'api';
    const suppliedClientId =
      text(req.body?.client_id, 100);
    const clientId = req.auth?.clientId || null;

    if (!clientId) {
      return res.status(401).json({
        status: 'error',
        code: 'AUTH_CONTEXT_REQUIRED'
      });
    }

    if (suppliedClientId && suppliedClientId !== clientId) {
      return res.status(403).json({
        status: 'error',
        code: 'CLIENT_SCOPE_MISMATCH'
      });
    }

    const idempotencyKey =
      text(req.body?.idempotency_key, 300);

    const inputType =
      text(req.body?.input_type, 20) ||
      'json';

    if (
      !['json', 'csv', 'xlsx']
        .includes(inputType)
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT_TYPE'
      });
    }

    const importMetadata = {
      environment: 'staging',
      input_type: inputType,
      ...(req.luminaFileImportMeta
        ? {
            file_import:
              req.luminaFileImportMeta
          }
        : {})
    };

    if (!idempotencyKey) {
      return res.status(400).json({
        status: 'error',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      });
    }


    if (
      clientId &&
      !isUuid(clientId)
    ) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_CLIENT_ID'
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({
        status: 'error',
        code: 'ROWS_REQUIRED'
      });
    }

    if (rows.length > SYNC_IMPORT_MAX_ROWS) {
      return res.status(400).json({
        status: 'error',
        code: 'BATCH_TOO_LARGE',
        max_rows: SYNC_IMPORT_MAX_ROWS
      });
    }


    const requestHash =
      buildRequestHash({
        filename,
        sourceName,
        clientId,
        rows
      });

    const client = await pool.connect();

    let importJobId;
    let advisoryLockHeld = false;

    try {
      await client.query('BEGIN');

      // ------------------------------------------------------
      // Atomic idempotency gate
      //
      // Requests using the same idempotency key are serialized
      // inside PostgreSQL. A concurrent request waits until the
      // first transaction finishes, then safely re-checks the
      // committed import job.
      // ------------------------------------------------------

      await client.query(
        `
          SELECT pg_advisory_lock(
            hashtext($1)
          )
        `,
        [`${clientId}:${idempotencyKey}`]
      );

      advisoryLockHeld = true;

      const prior = await client.query(
        `
          SELECT
            id,
            request_hash,
            status,
            total_rows,
            inserted_rows,
            updated_rows,
            matched_rows,
            duplicate_rows,
            rejected_rows,
            conflict_rows,
            suppressed_rows
          FROM import_jobs
          WHERE client_id = $1
            AND idempotency_key = $2
          LIMIT 1
        `,
        [clientId, idempotencyKey]
      );

      if (prior.rowCount > 0) {
        const existing = prior.rows[0];

        if (
          existing.request_hash &&
          existing.request_hash !== requestHash
        ) {
          await client.query('ROLLBACK');

          return res.status(409).json({
            status: 'error',
            code:
              'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
            import_job_id: existing.id
          });
        }

        await client.query('COMMIT');

        if (existing.status === 'completed') {
          return res.status(200).json({
            status: 'ok',
            replayed: true,
            import_job_id: existing.id,
            summary: {
              total: existing.total_rows,
              inserted: existing.inserted_rows,
              updated: existing.updated_rows,
              matched: existing.matched_rows,
              duplicates: existing.duplicate_rows,
              rejected: existing.rejected_rows,
              conflicts: existing.conflict_rows,
              suppressed: existing.suppressed_rows
            }
          });
        }

        if (existing.status === 'processing') {
          return res.status(202).json({
            status: 'processing',
            replayed: true,
            import_job_id: existing.id
          });
        }

        if (existing.status === 'failed') {
          return res.status(409).json({
            status: 'error',
            replayed: true,
            code: 'IDEMPOTENT_IMPORT_PREVIOUSLY_FAILED',
            import_job_id: existing.id,
            message:
              'This idempotency key belongs to a failed import. Retry with a new idempotency key.'
          });
        }

        return res.status(409).json({
          status: 'error',
          replayed: true,
          code: 'IMPORT_JOB_NOT_REPLAYABLE',
          import_job_id: existing.id,
          import_status: existing.status
        });
      }

      if (clientId) {
        const clientCheck =
          await client.query(
            `
              SELECT id
              FROM clients
              WHERE id = $1
              LIMIT 1
            `,
            [clientId]
          );

        if (clientCheck.rowCount === 0) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            status: 'error',
            code: 'CLIENT_NOT_FOUND'
          });
        }
      }

      const job = await client.query(
        `
          INSERT INTO import_jobs (
            filename,
            source_name,
            client_id,
            status,
            total_rows,
            started_at,
            created_by,
            idempotency_key,
            request_hash,
            metadata
          )
          VALUES (
            $1,
            $2,
            $3,
            'processing',
            $4,
            NOW(),
            'lumina-bridge',
            $5,
            $6,
            $7::jsonb
          )
          RETURNING id
        `,
        [
          filename,
          sourceName,
          clientId,
          rows.length,
          idempotencyKey,
          requestHash,
          JSON.stringify(importMetadata)
        ]
      );

      importJobId = job.rows[0].id;

      // Revision 14:
      // Persist the import-job identity before row processing.
      // If processing later fails, this job survives and can be
      // marked failed in a separate transaction.
      await client.query('COMMIT');

      await client.query('BEGIN');

      const {
        inserted,
        updated,
        matched,
        duplicates,
        rejected,
        conflicts,
        suppressed,
        results
      } = await processImportRows(
        client,
        {
          rows,
          importJobId,
          clientId,
          sourceName
        }
      );

      await client.query(
        `
          UPDATE import_jobs
          SET
            status = 'completed',
            processed_rows = $2,
            inserted_rows = $3,
            updated_rows = $4,
            matched_rows = $5,
            duplicate_rows = $6,
            rejected_rows = $7,
            conflict_rows = $8,
            suppressed_rows = $9,
            completed_at = NOW(),
            result_summary = $10::jsonb
          WHERE id = $1
        `,
        [
          importJobId,
          rows.length,
          inserted,
          updated,
          matched,
          duplicates,
          rejected,
          conflicts,
          suppressed,
          JSON.stringify({
            total: rows.length,
            inserted,
            updated,
            matched,
            duplicates,
            rejected,
            conflicts,
            suppressed
          })
        ]
      );

      await client.query(
        `
          INSERT INTO audit_events (
            actor,
            action,
            entity_type,
            entity_id,
            client_id,
            details
          )
          VALUES (
            'lumina-bridge',
            'import.completed',
            'import_job',
            $1,
            $2,
            $3::jsonb
          )
        `,
        [
          importJobId,
          clientId,
          JSON.stringify({
            total: rows.length,
            inserted,
            updated,
            matched,
            duplicates,
            rejected,
            conflicts,
            suppressed
          })
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        status: 'ok',
        import_job_id: importJobId,
        summary: {
          total: rows.length,
          inserted,
          updated,
          matched,
          duplicates,
          rejected,
          conflicts,
          suppressed
        },
        rows: results,
        ...(req.luminaFileImportMeta
          ? {
              file_import:
                req.luminaFileImportMeta
            }
          : {})
      });

    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Import rollback failed:',
          rollbackError
        );
      }

      console.error('Import failed:', error);

      // Revision 14:
      // The import job was committed before row processing,
      // so record the failure in a fresh transaction.
      if (importJobId) {
        try {
          await client.query('BEGIN');

          await persistSynchronousImportFailure(
            client,
            {
              importJobId,
              clientId,
              errorCode: error?.code || null
            }
          );

          await client.query('COMMIT');
        } catch (failureRecordError) {
          try {
            await client.query('ROLLBACK');
          } catch {}

          console.error(
            'Failed to persist import failure:',
            failureRecordError
          );
        }
      }

      res.status(500).json({
        status: 'error',
        code: 'IMPORT_FAILED',
        import_job_id: importJobId || null
      });
    } finally {
      if (advisoryLockHeld) {
        try {
          await client.query(
            `
              SELECT pg_advisory_unlock(
                hashtext($1)
              )
            `,
            [`${clientId}:${idempotencyKey}`]
          );
        } catch (unlockError) {
          console.error(
            'Failed to release import advisory lock:',
            unlockError
          );
        }
      }

      client.release();
    }
  };

  // Existing canonical JSON import route.
  app.post(
    '/api/v1/imports',
    handleImport
  );

  // Revision 15 file import route.
  //
  // Multipart fields:
  //   file             required .csv or .xlsx
  //   source_name      optional
  //   client_id        optional compatibility field; must match authorized client
  //   idempotency_key  required
  app.post(
    '/api/v1/imports/file',
    (req, res) => {
      upload.single('file')(
        req,
        res,
        async uploadError => {
          if (uploadError) {
            const tooLarge =
              uploadError.code ===
              'LIMIT_FILE_SIZE';

            return res
              .status(tooLarge ? 413 : 400)
              .json({
                status: 'error',
                code: tooLarge
                  ? 'FILE_TOO_LARGE'
                  : 'FILE_UPLOAD_FAILED',
                max_bytes:
                  FILE_IMPORT_MAX_BYTES
              });
          }

          if (!req.file) {
            return res.status(400).json({
              status: 'error',
              code: 'FILE_REQUIRED'
            });
          }

          try {
            const parsed =
              await parseUploadedFile(
                req.file
              );

            if (parsed.rows.length === 0) {
              return res.status(400).json({
                status: 'error',
                code: 'ROWS_REQUIRED'
              });
            }

            req.luminaFileImportMeta = {
              input_type:
                parsed.inputType,
              original_filename:
                req.file.originalname,
              worksheet_name:
                parsed.worksheetName,
              header_mapping:
                parsed.headerMapping,
              parsed_rows:
                parsed.rows.length
            };

            req.body = {
              ...req.body,
              filename:
                req.file.originalname,
              source_name:
                text(
                  req.body?.source_name,
                  200
                ) ||
                'file-upload',
              client_id:
                text(
                  req.body?.client_id,
                  100
                ),
              idempotency_key:
                text(
                  req.body
                    ?.idempotency_key,
                  300
                ),
              input_type:
                parsed.inputType,
              rows: parsed.rows
            };

            if (
              parsed.rows.length >
              SYNC_IMPORT_MAX_ROWS
            ) {
              try {
                const queued =
                  await queueParsedFileImport(
                    req,
                    parsed
                  );

                return res
                  .status(queued.httpStatus)
                  .json({
                    ...queued.body,
                    file_import:
                      req.luminaFileImportMeta
                  });
              } catch (queueError) {
                console.error(
                  'Async file import queue failed:',
                  queueError
                );

                return res.status(500).json({
                  status: 'error',
                  code:
                    'ASYNC_IMPORT_QUEUE_FAILED'
                });
              }
            }

            return await handleImport(
              req,
              res
            );

          } catch (error) {
            console.error(
              'File import parse failed:',
              error
            );

            if (
              error.code ===
              'BATCH_TOO_LARGE'
            ) {
              return res.status(400).json({
                status: 'error',
                code: 'BATCH_TOO_LARGE',
                max_rows:
                  ASYNC_IMPORT_MAX_ROWS,
                actual_rows:
                  error.actualRows || null
              });
            }

            if (
              error.code ===
              'DUPLICATE_MAPPED_HEADER'
            ) {
              return res.status(400).json({
                status: 'error',
                code:
                  'DUPLICATE_MAPPED_HEADER',
                field:
                  error.targetField || null
              });
            }

              if (
                [
                  'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH',
                  'CSV_RECORD_INCONSISTENT_COLUMNS'
                ].includes(error.code)
              ) {
                const message =
                  String(error.message || '');

                const lengthMatch =
                  message.match(
                    /expect\s+(\d+),\s*got\s+(\d+)/i
                  );

                const expectedColumns =
                  lengthMatch
                    ? Number(lengthMatch[1])
                    : null;

                const actualColumns =
                  Array.isArray(error.record)
                    ? error.record.length
                    : (
                        lengthMatch
                          ? Number(lengthMatch[2])
                          : null
                      );

                const line =
                  Number.isInteger(error.lines)
                    ? error.lines
                    : null;

                return res.status(400).json({
                  status: 'error',
                  code:
                    'FILE_COLUMN_COUNT_MISMATCH',
                  line,
                  expected_columns:
                    expectedColumns,
                  actual_columns:
                    actualColumns
                });
              }

              const safeCodes = new Set([
                'FILE_EMPTY',
                'FILE_HEADERS_REQUIRED',
                'EMPTY_FILE_HEADER',
                'INVALID_FILE_HEADER',
                'UNSUPPORTED_FILE_TYPE',
                'XLSX_WORKSHEET_REQUIRED'
              ]);

              return res.status(400).json({
                status: 'error',
                code:
                  safeCodes.has(error.code)
                    ? error.code
                    : 'FILE_PARSE_FAILED'
              });
          }
        }
      );
    }
  );

  app.get(
    '/api/v1/import-jobs/:id',
    async (req, res) => {
      const importJobId =
        text(req.params?.id, 100);

      if (!importJobId || !isUuid(importJobId)) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_IMPORT_JOB_ID'
        });
      }

      const result = await pool.query(
        `
          SELECT
            id,
            client_id,
            filename,
            source_name,
            status,
            total_rows,
            processed_rows,
            inserted_rows,
            updated_rows,
            matched_rows,
            duplicate_rows,
            rejected_rows,
            conflict_rows,
            suppressed_rows,
            started_at,
            completed_at,
            metadata,
            result_summary,
            created_at
          FROM import_jobs
          WHERE id = $1
          LIMIT 1
        `,
        [importJobId]
      );

      if (result.rowCount !== 1) {
        return res.status(404).json({
          status: 'error',
          code: 'IMPORT_JOB_NOT_FOUND'
        });
      }

      const job = result.rows[0];
      const total = Number(job.total_rows);
      const processed = Number(job.processed_rows);

      return res.status(200).json({
        status: 'ok',
        import_job: {
          ...job,
          total_rows: total,
          processed_rows: processed,
          inserted_rows:
            Number(job.inserted_rows),
          updated_rows:
            Number(job.updated_rows),
          matched_rows:
            Number(job.matched_rows),
          duplicate_rows:
            Number(job.duplicate_rows),
          rejected_rows:
            Number(job.rejected_rows),
          conflict_rows:
            Number(job.conflict_rows),
          suppressed_rows:
            Number(job.suppressed_rows),
          progress_percent:
            total > 0
              ? Math.min(
                  100,
                  Number(
                    (
                      processed /
                      total *
                      100
                    ).toFixed(2)
                  )
                )
              : 0
        }
      });
    }
  );

  app.post(
    '/api/v1/import-jobs/:id/retry',
    async (req, res) => {
      const importJobId =
        text(req.params?.id, 100);

      if (!importJobId || !isUuid(importJobId)) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_IMPORT_JOB_ID'
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const jobResult = await client.query(
          `
            SELECT
              id,
              client_id,
              status,
              processed_rows,
              metadata
            FROM import_jobs
            WHERE id = $1
            FOR UPDATE
          `,
          [importJobId]
        );

        if (jobResult.rowCount !== 1) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            status: 'error',
            code: 'IMPORT_JOB_NOT_FOUND'
          });
        }

        const job = jobResult.rows[0];

        if (job.status !== 'failed') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            status: 'error',
            code: 'IMPORT_JOB_NOT_FAILED',
            import_status: job.status
          });
        }

        if (job.metadata?.async !== true) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            status: 'error',
            code: 'IMPORT_JOB_NOT_ASYNC',
            message:
              'Only Revision 16 asynchronous import jobs can be retried through this endpoint.'
          });
        }

        await client.query(
          `
            UPDATE raw_source_rows
            SET processing_status = 'queued'
            WHERE import_job_id = $1
              AND processing_status = 'processing'
          `,
          [importJobId]
        );

        await client.query(
          `
            UPDATE import_jobs
            SET
              status = 'queued',
              completed_at = NULL,
              result_summary =
                jsonb_build_object(
                  'status', 'queued',
                  'code', 'RETRY_QUEUED',
                  'processed', processed_rows
                )
            WHERE id = $1
          `,
          [importJobId]
        );

        await client.query(
          `
            INSERT INTO audit_events (
              actor,
              action,
              entity_type,
              entity_id,
              client_id,
              details
            )
            VALUES (
              'lumina-bridge',
              'import.retry_queued',
              'import_job',
              $1,
              $2,
              $3::jsonb
            )
          `,
          [
            importJobId,
            job.client_id,
            JSON.stringify({
              processed_rows:
                Number(job.processed_rows)
            })
          ]
        );

        await client.query('COMMIT');

        try {
          await enqueueImportTask(importJobId);

        } catch (enqueueError) {
          console.error(
            'Import retry enqueue failed:',
            enqueueError
          );

          try {
            await client.query('BEGIN');

            await client.query(
              `
                UPDATE import_jobs
                SET
                  status = 'failed',
                  completed_at = NOW(),
                  result_summary = $2::jsonb
                WHERE id = $1
              `,
              [
                importJobId,
                JSON.stringify({
                  status: 'failed',
                  code:
                    'IMPORT_RETRY_ENQUEUE_FAILED',
                  error_code:
                    enqueueError?.code || null,
                  processed:
                    Number(job.processed_rows)
                })
              ]
            );

            await client.query(
              `
                INSERT INTO audit_events (
                  actor,
                  action,
                  entity_type,
                  entity_id,
                  client_id,
                  details
                )
                VALUES (
                  'lumina-bridge',
                  'import.retry_enqueue_failed',
                  'import_job',
                  $1,
                  $2,
                  $3::jsonb
                )
              `,
              [
                importJobId,
                job.client_id,
                JSON.stringify({
                  code:
                    'IMPORT_RETRY_ENQUEUE_FAILED',
                  error_code:
                    enqueueError?.code || null,
                  processed_rows:
                    Number(job.processed_rows)
                })
              ]
            );

            await client.query('COMMIT');

          } catch (compensationError) {
            try {
              await client.query('ROLLBACK');
            } catch {}

            console.error(
              'Import retry compensation failed:',
              compensationError
            );
          }

          return res.status(503).json({
            status: 'error',
            code:
              'IMPORT_RETRY_ENQUEUE_FAILED',
            import_job_id: importJobId
          });
        }

        return res.status(202).json({
          status: 'queued',
          import_job_id: importJobId
        });

      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {}

        console.error(
          'Import retry failed:',
          error
        );

        return res.status(500).json({
          status: 'error',
          code: 'IMPORT_RETRY_FAILED'
        });

      } finally {
        client.release();
      }
    }
  );

  app.post(
    '/internal/import-jobs/:id/process',
    async (req, res) => {
      const queueName =
        req.get('X-CloudTasks-QueueName');

      if (queueName !== TASKS_QUEUE) {
        return res.status(403).json({
          status: 'error',
          code: 'CLOUD_TASKS_ONLY'
        });
      }

      const importJobId =
        text(req.params?.id, 100);

      if (!importJobId || !isUuid(importJobId)) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_IMPORT_JOB_ID'
        });
      }

      const retryCount = Number(
        req.get(
          'X-CloudTasks-TaskRetryCount'
        ) || 0
      );

      try {
        const result =
          await processAsyncImportJob(
            importJobId,
            retryCount
          );

        if (result?.status === 'busy') {
          return res.status(503).json({
            status: 'busy',
            code: 'IMPORT_WORKER_BUSY'
          });
        }

        return res.status(200).json({
          status: 'ok',
          worker: result
        });

      } catch (error) {
        console.error(
          'Async import worker failed:',
          {
            import_job_id: importJobId,
            retry_count: retryCount,
            error:
              error instanceof Error
                ? error.message
                : String(error)
          }
        );

        return res.status(500).json({
          status: 'error',
          code: 'ASYNC_IMPORT_WORKER_FAILED'
        });
      }
    }
  );

}
