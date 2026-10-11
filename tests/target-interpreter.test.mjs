import test from 'node:test';
import assert from 'node:assert/strict';

import {interpretInput} from '../product-routes.js';

test('standalone Singapore becomes a country filter', () => {
  const result = interpretInput('Singapore');

  assert.equal(result.original_input, 'Singapore');
  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {country: 'Singapore'});
  assert.match(result.understood_as, /country: Singapore/);
  assert.equal(result.interpreter_version, 'r17-deterministic-v2');
});

test('standalone email becomes an exact email filter', () => {
  const result = interpretInput('person@example.com');

  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {email: 'person@example.com'});
  assert.match(result.understood_as, /email: person@example.com/);
});

test('explicit field:value syntax produces canonical filters', () => {
  const result = interpretInput(
    'title: CTO; industry: Telecommunications; country: Netherlands'
  );

  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {
    title: 'CTO',
    industry: 'Telecommunications',
    country: 'Netherlands'
  });
});

test('field-name typo correction maps titel to title', () => {
  const result = interpretInput('titel: CTO');

  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {title: 'CTO'});
});

test('recognized prefix syntax produces filters', () => {
  const result = interpretInput('department Engineering');

  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {department: 'Engineering'});
});

test('unrecognized natural language remains free-text search', () => {
  const result = interpretInput('cloud infrastructure leaders');

  assert.equal(result.q, 'cloud infrastructure leaders');
  assert.deepEqual(result.filters, {});
  assert.equal(
    result.understood_as,
    'Search: cloud infrastructure leaders'
  );
});

test('direct filters are normalized through aliases and typo correction', () => {
  const result = interpretInput('', {
    job_title: 'CEO',
    sector: 'Telecommunications',
    contact_country: 'Singapore'
  });

  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {
    title: 'CEO',
    industry: 'Telecommunications',
    country: 'Singapore'
  });
});

test('explicit parsed filters override matching direct filters', () => {
  const result = interpretInput(
    'country: Netherlands',
    {country: 'Singapore'}
  );

  assert.deepEqual(result.filters, {country: 'Netherlands'});
});

test('empty input returns the existing no-terms contract', () => {
  const result = interpretInput('');

  assert.equal(result.original_input, null);
  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {});
  assert.equal(result.understood_as, 'No search terms detected');
  assert.equal(result.interpreter_version, 'r17-deterministic-v2');
});
