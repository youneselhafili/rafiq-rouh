const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { fetchPrayerTimes, fetchZonePrayerSchedule } = require('../src/services/adhanService');

const samples = [
    ['Marrakech', 'Morocco', 21],
    ['Makkah', 'Saudi Arabia', 4],
    ['London', 'UK', 2],
    ['New York', 'USA', 2],
    ['Kuala Lumpur', 'Malaysia', 17],
];

test('global prayer API returns valid daily timings across countries', async () => {
    const results = await Promise.all(samples.map(([city, country, method]) =>
        fetchPrayerTimes(city, country, method)));
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d/;
    results.forEach((result, index) => {
        assert.ok(result, `No prayer result for ${samples[index][0]}, ${samples[index][1]}`);
        for (const prayer of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) {
            assert.match(result.timings[prayer], timePattern, `Invalid ${prayer} for ${samples[index][0]}`);
        }
    });
});

test('Moroccan zones use the global JSON API as their primary source', async () => {
    const result = await fetchZonePrayerSchedule({
        country: 'Morocco', city: 'Marrakech', timezone: 'Africa/Casablanca',
        channelId: 'test', enabled: true,
    });
    assert.equal(result?.source, 'aladhan');
    assert.equal(result?.fallbackUsed, false);
});
