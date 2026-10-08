import { registerImportReviewRoutes } from './import-review-routes.js';
import { registerCampaignRoutes } from './campaign-routes.js';
import { registerIcpRoutes } from './icp-routes.js';
import { registerConflictRoutes } from './conflict-routes.js';
import { registerFrontend } from './frontend-routes.mjs';
import { registerGate1Routes } from './gate1-routes.js';
import express from 'express';
import pg from 'pg';
import { Connector } from '@google-cloud/cloud-sql-connector';
import { registerImportRoutes } from './importer.js';
import { registerProductRoutes } from './product-routes.js';
import { registerAuthorization } from './authz.js';

const { Pool } = pg;

const app = express();
app.use(express.json());

const INSTANCE_CONNECTION_NAME =
  'lumina-staging-509411:asia-southeast1:lumina-pg-staging';

const DB_USER =
  'lumina-bridge@lumina-staging-509411.iam';

const DB_NAME = 'lumina';

const connector = new Connector();

const clientOptions = await connector.getOptions({
  instanceConnectionName: INSTANCE_CONNECTION_NAME,
  ipType: 'PUBLIC',
  authType: 'IAM'
});

const pool = new Pool({
  ...clientOptions,
  user: DB_USER,
  database: DB_NAME,
  max: 5
});

app.get('/', (_req, res) => {
  res.json({
    service: 'lumina-bridge',
    version: '0.1.0',
    status: 'running'
  });
});




app.get('/api/v1/health', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS user,
        NOW() AS database_time
    `);

    res.json({
      status: 'ok',
      api: 'connected',
      database: 'connected',
      environment: 'staging',
      details: result.rows[0]
    });
  } catch (error) {
    console.error('Database health check failed:', error);

    res.status(500).json({
      status: 'error',
      api: 'connected',
      database: 'failed'
    });
  }
});


// R19: authenticate and resolve caller -> client membership before all other API routes.
registerAuthorization(app, pool);


function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

app.get('/api/v1/people', async (req, res) => {
  try {
    const limit = boundedInt(req.query.limit, 25, 1, 100);
    const offset = boundedInt(req.query.offset, 0, 0, 1000000);

    const q =
      typeof req.query.q === 'string'
        ? req.query.q.trim()
        : '';

    const params = [limit, offset];

    let whereClause = '';

    if (q) {
      params.push(`%${q}%`);

      whereClause = `
        WHERE
          p.full_name ILIKE $3
          OR p.current_title ILIKE $3
          OR p.department ILIKE $3
          OR p.seniority ILIKE $3
          OR p.contact_city ILIKE $3
          OR p.contact_country ILIKE $3
      `;
    }

    const result = await pool.query(
      `
        SELECT
          p.id,
          p.full_name,
          p.first_name,
          p.last_name,
          p.current_title,
          p.department,
          p.seniority,
          p.contact_city,
          p.contact_country,
          p.linkedin_url,
          p.created_at,
          p.updated_at
        FROM persons p
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT $1
        OFFSET $2
      `,
      params
    );

    res.set('Cache-Control', 'no-store');

    res.json({
      status: 'ok',
      count: result.rows.length,
      pagination: {
        limit,
        offset
      },
      data: result.rows
    });
  } catch (error) {
    console.error('People query failed:', error);

    res.status(500).json({
      status: 'error',
      code: 'PEOPLE_QUERY_FAILED'
    });
  }
});



function cleanText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();

  if (!cleaned) return null;

  return cleaned.slice(0, maxLength);
}

app.post('/api/v1/people', async (req, res) => {
  const fullName = cleanText(req.body.full_name, 300);

  if (!fullName) {
    return res.status(400).json({
      status: 'error',
      code: 'FULL_NAME_REQUIRED'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const personResult = await client.query(
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
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10::jsonb
        )
        RETURNING
          id,
          full_name,
          first_name,
          last_name,
          current_title,
          department,
          seniority,
          contact_city,
          contact_country,
          linkedin_url,
          created_at,
          updated_at
      `,
      [
        fullName,
        cleanText(req.body.first_name, 150),
        cleanText(req.body.last_name, 150),
        cleanText(req.body.current_title, 300),
        cleanText(req.body.department, 150),
        cleanText(req.body.seniority, 100),
        cleanText(req.body.contact_city, 150),
        cleanText(req.body.contact_country, 150),
        cleanText(req.body.linkedin_url, 1000),
        JSON.stringify({
          source: 'api',
          environment: 'staging'
        })
      ]
    );

    const person = personResult.rows[0];

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
          $1,
          'person.created',
          'person',
          $2,
          $3::jsonb
        )
      `,
      [
        'lumina-bridge',
        person.id,
        JSON.stringify({
          source: 'api',
          environment: 'staging'
        })
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'ok',
      data: person
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Person create failed:', error);

    res.status(500).json({
      status: 'error',
      code: 'PERSON_CREATE_FAILED'
    });
  } finally {
    client.release();
  }
});



registerIcpRoutes(app, pool);
registerGate1Routes(app, pool);
registerConflictRoutes(app, pool);
registerCampaignRoutes(app, pool);
registerProductRoutes(app, pool);
registerImportReviewRoutes(app, pool);
registerImportRoutes(app, pool);

// Lumina Gate 1 frontend: same service and same origin.
registerFrontend(app);

const port = process.env.PORT || 8080;

app.listen(port, '0.0.0.0', () => {
  console.log(`Lumina Bridge listening on port ${port}`);
});

process.on('SIGTERM', async () => {
  await pool.end();
  connector.close();
  process.exit(0);
});
