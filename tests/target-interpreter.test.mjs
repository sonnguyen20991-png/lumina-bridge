import test from 'node:test';
import assert from 'node:assert/strict';

import {interpretInput} from '../product-routes.js';

test('standalone Singapore becomes a country filter', () => {
  const result = interpretInput('Singapore');

  assert.equal(result.original_input, 'Singapore');
  assert.equal(result.q, null);
  assert.deepEqual(result.filters, {country: 'Singapore'});
  assert.match(result.understood_as, /country: Singapore/);
  assert.equal(result.interpreter_version, 'r18-intelligence-v3');
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
  assert.equal(result.interpreter_version, 'r18-intelligence-v3');
});


test('structured interpretation exposes intelligence metadata', () => {
  const result = interpretInput(
    'title: CTO; country: Singapore'
  );

  assert.equal(result.intent, 'structured_search');
  assert.equal(result.confidence, 0.98);
  assert.deepEqual(result.recognized_entities, [
    {field: 'title', value: 'CTO'},
    {field: 'country', value: 'Singapore'}
  ]);
  assert.deepEqual(result.corrections, []);
  assert.deepEqual(result.ambiguities, []);
  assert.deepEqual(result.unsupported_intents, []);
});

test('free text is explicitly marked as lower-confidence ambiguous intent', () => {
  const result = interpretInput(
    'cloud infrastructure leaders'
  );

  assert.equal(result.intent, 'free_text_search');
  assert.equal(result.confidence, 0.60);
  assert.equal(result.recognized_entities.length, 0);
  assert.equal(result.ambiguities.length, 1);
});

test('hybrid search distinguishes filters from unresolved free text', () => {
  const result = interpretInput(
    'title: CTO; fast growing infrastructure companies'
  );

  assert.equal(result.intent, 'hybrid_search');
  assert.equal(result.confidence, 0.85);
  assert.deepEqual(result.filters, {title: 'CTO'});
  assert.equal(result.q, 'fast growing infrastructure companies');
  assert.equal(result.ambiguities.length, 1);
});

test('empty interpretation exposes zero-confidence empty intent', () => {
  const result = interpretInput('');

  assert.equal(result.intent, 'empty');
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.recognized_entities, []);
});


test('field typo is surfaced as an explicit correction', () => {
  const result = interpretInput('titel: CTO');

  assert.deepEqual(result.filters, {title: 'CTO'});
  assert.deepEqual(result.corrections, [
    {
      type: 'field_typo',
      original: 'titel',
      corrected_to: 'title'
    }
  ]);
});

test('known field alias is surfaced as an explicit normalization', () => {
  const result = interpretInput('sector: Telecommunications');

  assert.deepEqual(result.filters, {
    industry: 'Telecommunications'
  });
  assert.deepEqual(result.corrections, [
    {
      type: 'field_alias',
      original: 'sector',
      corrected_to: 'industry'
    }
  ]);
});

test('direct-filter aliases also produce correction metadata', () => {
  const result = interpretInput('', {
    job_title: 'CEO',
    contact_country: 'Singapore'
  });

  assert.deepEqual(result.corrections, [
    {
      type: 'field_alias',
      original: 'job_title',
      corrected_to: 'title'
    },
    {
      type: 'field_alias',
      original: 'contact_country',
      corrected_to: 'country'
    }
  ]);
});

test('unknown explicit field remains free text and reports ambiguity', () => {
  const result = interpretInput('companysize: 500 employees');

  assert.equal(result.q, 'companysize: 500 employees');
  assert.deepEqual(result.filters, {});
  assert.ok(
    result.ambiguities.some(message =>
      message.includes('Could not map "companysize"')
    )
  );
});
