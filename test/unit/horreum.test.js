'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
require('./load');
const horreum = require('../../src/content/horreum.js');

const radio = (value) => ({ value });

test('counts the resource packages on the packages page', () => {
  const item = (basis, amount) =>
    `<div class="packageItem"><div data-container-number="-1"><div data-content-type="1" data-basis="${basis}"${amount ? ` data-amount="${amount}"` : ''}></div></div></div>`;
  const doc = new JSDOM(`<div id="content">${item('18-24', 12)}${item('18-5', 3)}${item('2-3', 1)}${item('18-1')}</div>`).window.document;
  assert.deepEqual(horreum.countPackageResources(doc), { packages: 3, amount: 16 });
  assert.deepEqual(horreum.countPackageResources(new JSDOM('<div></div>').window.document), { packages: 0, amount: 0 });
});

test('picks the "sell" overflow option, never "delete"', () => {
  const { sellOption } = horreum._internal;
  const byName = [radio('delete'), radio('sell')];
  assert.equal(sellOption(byName), byName[1]);
  const deleteFirst = [radio('remove'), radio('x')];
  assert.equal(sellOption(deleteFirst), deleteFirst[1]);
  // Unnamed values: the game lists "sell" first.
  const numeric = [radio('1'), radio('0')];
  assert.equal(sellOption(numeric), numeric[0]);
});
