const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, project: require('node:path').join(__dirname, '../tsconfig.json') });
const { locations, listCities, listAreas, parentCityId } = require('../src/utils/locationCatalog');

test('Moroccan administrative catalog preserves unique IDs and province links', () => {
    assert.equal(new Set(locations.map(x => x.nameEn)).size, locations.length);
    for (const x of locations.filter(x => x.country === 'Morocco')) {
        assert.ok(x.provinceCode, x.nameEn);
        if (x.locationType !== 'city') assert.ok(parentCityId(x.nameEn), x.nameEn);
    }
});
test('Marrakech areas include Ouahat Sidi Brahim and its districts, excluding other cities districts', () => {
    const areas = listAreas('Marrakech');
    assert.ok(areas.some(x => x.nameEn === 'Ouahat Sidi Brahim' && x.locationType === 'commune'));
    assert.ok(areas.some(x => x.nameEn === 'Gueliz' && x.locationType === 'district'));
    assert.ok(areas.every(x => x.provinceCode === '7351'));
    assert.ok(!listAreas('Rabat').some(x => x.nameEn === 'Ouahat Sidi Brahim'));
    assert.ok(!listCities('Morocco').some(x => x.nameEn === 'Ouahat Sidi Brahim'));
    assert.deepEqual(listAreas(undefined), []);
});
test('all country city menus retain at least one selectable city', () => {
    for (const country of new Set(locations.map(x => x.country))) assert.ok(listCities(country).length, country);
});
