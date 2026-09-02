const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./harness');

const A = app();

test('normalize strips accents and lowercases', () => {
  assert.equal(A.normalize('Camión ÁÉÍ'), 'camion aei');
});

test('matchPhrase contract: caller passes normalized text', () => {
  assert.ok(A.matchPhrase(A.normalize('quiero CREAR contenido ya'), ['crear contenido']));
  assert.ok(!A.matchPhrase(A.normalize('crear espacio'), ['crear contenido']));
});

test('spoken numbers — Spanish / English / Italian', () => {
  assert.equal(A.parseNumberFromVoice('veintisiete'), 27);
  assert.equal(A.parseNumberFromVoice('twenty'), 20);
  assert.equal(A.parseNumberFromVoice('ventisette'), 27);
  assert.equal(A.parseNumberFromVoice('42'), 42);
  assert.equal(A.parseNumberFromVoice('hola'), null);
});

test('NUM_WORDS has no cross-language value conflicts on shared words', () => {
  assert.equal(A.NUM_WORDS.uno, 1);      // ES + IT
  assert.equal(A.NUM_WORDS.sei, 6);      // IT only? shared value is what matters
  assert.equal(A.NUM_WORDS.quarto, 4);   // ES + IT
});

test('spoken dates — full date in each language', () => {
  assert.equal(A.parseDateFromVoice('15 de mayo de 2025'), '2025-05-15');
  assert.equal(A.parseDateFromVoice('march 3 2026') || A.parseDateFromVoice('3 march 2026'), '2026-03-03');
  assert.equal(A.parseDateFromVoice('quindici dicembre 2026'), '2026-12-15'); // audit: dicembre was missing
  assert.equal(A.parseDateFromVoice('ventuno marzo 2027'), '2027-03-21');
});

test('slash and ISO date formats', () => {
  assert.equal(A.parseDateFromVoice('15/05/2025'), '2025-05-15');
  assert.equal(A.parseDateFromVoice('2025-05-15'), '2025-05-15');
});

test('liferayErrorMessage extracts friendly text', () => {
  assert.equal(
    A.liferayErrorMessage({ kind: 'server', body: '{"title":"The value is invalid"}' }),
    'The value is invalid'
  );
});
