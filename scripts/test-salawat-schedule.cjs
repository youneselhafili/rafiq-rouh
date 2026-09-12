const assert = require('node:assert/strict');
const { test } = require('node:test');
const moment = require('moment-timezone');
require('ts-node/register/transpile-only');
const { calculateNextSalawatRun, validSalawatTimezone } = require('../src/utils/salawatSchedule');

test('interval schedules retain their exact elapsed duration', () => {
    const now = moment.utc('2026-09-12T09:00:00Z');
    const next = calculateNextSalawatRun({
        scheduleMode: 'interval', intervalHours: 8, fixedTimes: [], timezone: 'Africa/Casablanca',
    }, now);
    assert.equal(next.toISOString(), '2026-09-12T17:00:00.000Z');
});

test('fixed schedules use Morocco time independently of the VPS timezone', () => {
    const now = moment.utc('2026-09-12T09:00:00Z'); // 10:00 in Casablanca
    const next = calculateNextSalawatRun({
        scheduleMode: 'fixed', intervalHours: 8, fixedTimes: ['09:30', '10:30'], timezone: 'Africa/Casablanca',
    }, now);
    assert.equal(next.toISOString(), '2026-09-12T09:30:00.000Z');
});

test('invalid timezone names are rejected', () => {
    assert.equal(validSalawatTimezone('Africa/Casablanca'), true);
    assert.equal(validSalawatTimezone('Africa/الدار البيضاء'), false);
});
