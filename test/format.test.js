const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./harness');

const A = app();

test('modules load in order', () => {
  assert.equal(A.__files.length, 8);
  assert.equal(typeof A.applyInlinePunctuation, 'function');
});

test('inline punctuation — Spanish', () => {
  assert.equal(
    A.applyInlinePunctuation('hola coma mundo punto y coma bien dos puntos si punto'),
    'hola, mundo; bien: si.'
  );
  assert.equal(A.applyInlinePunctuation('abrir interrogación cómo estás interrogación'), '¿cómo estás?');
});

test('inline punctuation — English', () => {
  assert.equal(
    A.applyInlinePunctuation('hello comma world semicolon fine colon yes period'),
    'hello, world; fine: yes.'
  );
  assert.equal(A.applyInlinePunctuation('really question mark'), 'really?');
});

test('inline punctuation — Italian (audit P1-6)', () => {
  assert.equal(
    A.applyInlinePunctuation('ciao virgola mondo punto e virgola bene due punti si punto'),
    'ciao, mondo; bene: si.'
  );
  assert.equal(A.applyInlinePunctuation('davvero punto interrogativo'), 'davvero?');
  assert.equal(A.applyInlinePunctuation('attento punto esclamativo'), 'attento!');
});

test('question detection covers the three languages', () => {
  for (const q of ['qué hora es', 'where is it', 'dove si trova', 'perché no', 'cuánto cuesta']) {
    assert.ok(A.QUESTION_STARTERS.test(q), q);
  }
  assert.ok(!A.QUESTION_STARTERS.test('la reunión es mañana'));
});

test('question wrapping respects locale', () => {
  A.__setLocale('es-ES');
  assert.equal(A.wrapAsQuestion('qué hora es'), '¿qué hora es?');
  A.__setLocale('it-IT');
  assert.equal(A.wrapAsQuestion('dove si trova'), 'dove si trova?');
});

test('formatAsTitle capitalizes without trailing period', () => {
  A.__setLocale('es-ES');
  const t = A.formatAsTitle('  las rebajas de verano  ');
  assert.equal(t, 'Las rebajas de verano');
});

test('formatAsBody adds final period and capitalizes sentences', () => {
  A.__setLocale('en-US');
  const b = A.formatAsBody('this is one period this is two');
  assert.ok(b.startsWith('This is one.'));
  assert.ok(b.endsWith('.'));
});
