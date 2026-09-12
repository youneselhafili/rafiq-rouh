const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { parseMonthlyTable } = require('../src/services/yabiladiService');

test('parses the current Yabiladi prayer-table markup with nested date spans', () => {
    const html = `
      <table class="prayer-table">
        <thead><tr><th>Jour</th><th>Fajr</th></tr></thead>
        <tbody><tr class="prayer-row-today">
          <td class="prayer-day"><span>Samedi</span><span class="prayer-day-date">12/09</span><span>Aujourd'hui</span></td>
          <td>05:48</td><td>13:34</td><td>17:00</td><td>19:47</td><td>20:59</td>
        </tr></tbody>
      </table>`;
    const result = parseMonthlyTable(html);
    assert.deepEqual(result?.get('12/09'), {
        Fajr: '05:48', Dhuhr: '13:34', Asr: '17:00', Maghrib: '19:47', Isha: '20:59',
    });
});

test('keeps support for the older prayer class and direct date cells', () => {
    const html = `<table class="prayer"><tr><td>01/02</td><td>06:01</td><td>13:00</td><td>16:10</td><td>18:20</td><td>19:30</td></tr></table>`;
    assert.equal(parseMonthlyTable(html)?.get('01/02')?.Isha, '19:30');
});
