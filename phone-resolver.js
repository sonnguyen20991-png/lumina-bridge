function text(value, max = 1000) {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();

  return cleaned
    ? cleaned.slice(0, max)
    : null;
}

function uniquePhoneEntries(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const phone = text(entry.phone, 200);

    if (!phone) continue;

    const key = phone
      .replace(/[^\d+]/g, '')
      .toLowerCase();

    if (!key || seen.has(key)) continue;

    seen.add(key);

    result.push({
      phone,
      type: entry.type,
      field: entry.field
    });
  }

  return result;
}

function personPhoneEntries(row) {
  return uniquePhoneEntries([
    {
      phone: row.contact_phone_1,
      type: 'contact',
      field: 'contact_phone_1'
    },
    {
      phone: row.contact_phone1,
      type: 'contact',
      field: 'contact_phone1'
    },
    {
      phone: row.contactPhone1,
      type: 'contact',
      field: 'contactPhone1'
    },
    {
      phone: row.ContactPhone1,
      type: 'contact',
      field: 'ContactPhone1'
    },
    {
      phone: row.phone,
      type: 'contact',
      field: 'phone'
    },
    {
      phone: row.Phone,
      type: 'contact',
      field: 'Phone'
    },
    {
      phone: row.mobile_phone,
      type: 'mobile',
      field: 'mobile_phone'
    },
    {
      phone: row.mobilePhone,
      type: 'mobile',
      field: 'mobilePhone'
    },
    {
      phone: row.MobilePhone,
      type: 'mobile',
      field: 'MobilePhone'
    },
    {
      phone: row.contact_phone_2,
      type: 'contact',
      field: 'contact_phone_2'
    },
    {
      phone: row.contact_phone2,
      type: 'contact',
      field: 'contact_phone2'
    },
    {
      phone: row.contactPhone2,
      type: 'contact',
      field: 'contactPhone2'
    },
    {
      phone: row.ContactPhone2,
      type: 'contact',
      field: 'ContactPhone2'
    }
  ]);
}

function companyPhoneEntries(row) {
  return uniquePhoneEntries([
    {
      phone: row.company_phone_1,
      type: 'company',
      field: 'company_phone_1'
    },
    {
      phone: row.company_phone1,
      type: 'company',
      field: 'company_phone1'
    },
    {
      phone: row.companyPhone1,
      type: 'company',
      field: 'companyPhone1'
    },
    {
      phone: row.CompanyPhone1,
      type: 'company',
      field: 'CompanyPhone1'
    },
    {
      phone: row.company_phone_2,
      type: 'company',
      field: 'company_phone_2'
    },
    {
      phone: row.company_phone2,
      type: 'company',
      field: 'company_phone2'
    },
    {
      phone: row.companyPhone2,
      type: 'company',
      field: 'companyPhone2'
    },
    {
      phone: row.CompanyPhone2,
      type: 'company',
      field: 'CompanyPhone2'
    }
  ]);
}

async function upsertOwnerPhones(
  client,
  {
    ownerType,
    ownerId,
    entries,
    sourceName,
    importJobId
  }
) {
  if (!ownerId || entries.length === 0) {
    return [];
  }

  if (
    ownerType !== 'person' &&
    ownerType !== 'company'
  ) {
    throw new Error(
      'Invalid phone owner type'
    );
  }

  // Serialize phone writes for the same canonical owner.
  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtext($1)
      )
    `,
    [
      `lumina-phone:${ownerType}:${ownerId}`
    ]
  );

  const ownerColumn =
    ownerType === 'person'
      ? 'person_id'
      : 'company_id';

  const primaryCheck = await client.query(
    `
      SELECT id
      FROM phones
      WHERE ${ownerColumn} = $1
        AND is_primary = TRUE
      LIMIT 1
    `,
    [ownerId]
  );

  let hasPrimary =
    primaryCheck.rowCount > 0;

  const saved = [];

  for (const entry of entries) {
    const normalizedResult =
      await client.query(
        `
          SELECT lumina_normalize_phone($1)
            AS normalized_phone
        `,
        [entry.phone]
      );

    const normalizedPhone =
      normalizedResult.rows[0]
        ?.normalized_phone || null;

    if (!normalizedPhone) {
      continue;
    }

    const existing =
      await client.query(
        `
          SELECT
            id,
            phone_number,
            phone_type,
            is_primary
          FROM phones
          WHERE ${ownerColumn} = $1
            AND normalized_phone = $2
          LIMIT 1
        `,
        [
          ownerId,
          normalizedPhone
        ]
      );

    if (existing.rowCount > 0) {
      const phoneRow =
        existing.rows[0];

      const promotePrimary =
        !hasPrimary &&
        !phoneRow.is_primary;

      await client.query(
        `
          UPDATE phones
          SET
            phone_type =
              COALESCE(
                phone_type,
                $2
              ),
            source_name =
              COALESCE(
                source_name,
                $3
              ),
            metadata =
              metadata ||
              $4::jsonb,
            is_primary =
              CASE
                WHEN $5 THEN TRUE
                ELSE is_primary
              END
          WHERE id = $1
        `,
        [
          phoneRow.id,
          entry.type,
          sourceName,
          JSON.stringify({
            last_import_job_id:
              importJobId,
            last_source_field:
              entry.field
          }),
          promotePrimary
        ]
      );

      const isPrimary =
        phoneRow.is_primary ||
        promotePrimary;

      saved.push({
        id: phoneRow.id,
        normalized_phone:
          normalizedPhone,
        created: false,
        is_primary:
          isPrimary
      });

      if (isPrimary) {
        hasPrimary = true;
      }

      continue;
    }

    const makePrimary =
      !hasPrimary;

    const inserted =
      await client.query(
        `
          INSERT INTO phones (
            person_id,
            company_id,
            phone_number,
            phone_type,
            is_primary,
            source_name,
            metadata,
            normalized_phone
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8
          )
          RETURNING
            id,
            normalized_phone,
            is_primary
        `,
        [
          ownerType === 'person'
            ? ownerId
            : null,
          ownerType === 'company'
            ? ownerId
            : null,
          entry.phone,
          entry.type,
          makePrimary,
          sourceName,
          JSON.stringify({
            first_import_job_id:
              importJobId,
            first_source_field:
              entry.field
          }),
          normalizedPhone
        ]
      );

    const phoneRow =
      inserted.rows[0];

    saved.push({
      id: phoneRow.id,
      normalized_phone:
        phoneRow.normalized_phone,
      created: true,
      is_primary:
        phoneRow.is_primary
    });

    if (makePrimary) {
      hasPrimary = true;
    }
  }

  return saved;
}

export async function upsertPersonPhones(
  client,
  {
    personId,
    row,
    sourceName,
    importJobId
  }
) {
  return upsertOwnerPhones(
    client,
    {
      ownerType: 'person',
      ownerId: personId,
      entries:
        personPhoneEntries(row),
      sourceName,
      importJobId
    }
  );
}

export async function upsertCompanyPhones(
  client,
  {
    companyId,
    row,
    sourceName,
    importJobId
  }
) {
  return upsertOwnerPhones(
    client,
    {
      ownerType: 'company',
      ownerId: companyId,
      entries:
        companyPhoneEntries(row),
      sourceName,
      importJobId
    }
  );
}


export async function upsertPhones(
  client,
  {
    personId,
    companyId,
    row,
    sourceName,
    importJobId
  }
) {
  const personPhones =
    await upsertPersonPhones(
      client,
      {
        personId,
        row,
        sourceName,
        importJobId
      }
    );

  const companyPhones =
    await upsertCompanyPhones(
      client,
      {
        companyId,
        row,
        sourceName,
        importJobId
      }
    );

  return {
    personPhones,
    companyPhones
  };
}
