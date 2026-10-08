import pg from 'pg';
import { Connector } from '@google-cloud/cloud-sql-connector';

const { Pool } = pg;

const connector = new Connector();

const options = await connector.getOptions({
  instanceConnectionName:
    'lumina-staging-509411:asia-southeast1:lumina-pg-staging',
  ipType: 'PUBLIC',
  authType: 'IAM'
});

const pool = new Pool({
  ...options,
  user: 'lumina-bridge@lumina-staging-509411.iam',
  database: 'lumina',
  max: 1
});

try {
  const clients = await pool.query(`
    SELECT
      id,
      name,
      status,
      created_at
    FROM public.clients
    ORDER BY created_at, id
  `);

  console.log('===== CLIENTS =====');
  console.log(JSON.stringify(clients.rows, null, 2));

  const auth = await pool.query(`
    SELECT
      p.id AS principal_id,
      p.provider,
      p.subject,
      p.email,
      p.status AS principal_status,
      cm.client_id,
      c.name AS client_name,
      cm.role,
      cm.status AS membership_status
    FROM public.app_principals p
    LEFT JOIN public.client_memberships cm
      ON cm.principal_id = p.id
    LEFT JOIN public.clients c
      ON c.id = cm.client_id
    ORDER BY p.created_at, cm.created_at
  `);

  console.log('===== PRINCIPALS_AND_MEMBERSHIPS =====');
  console.log(JSON.stringify(auth.rows, null, 2));

} finally {
  await pool.end();
  connector.close();
}
