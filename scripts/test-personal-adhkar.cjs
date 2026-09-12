const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { hasEnabledAdhkarCategory } = require('../src/utils/adhkarSelection');

test('one selected dhikr activates personal adhkar', () => {
    assert.equal(hasEnabledAdhkarCategory({ adhkar_sabah: false, adhkar_masa: true }), true);
});

test('personal adhkar stop when every category is disabled', () => {
    assert.equal(hasEnabledAdhkarCategory({ adhkar_sabah: false, adhkar_masa: false }), false);
});
