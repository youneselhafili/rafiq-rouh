import data from '../data/cities.json';

export interface Location {
    name: string; nameEn: string; country: string; countryAr: string; timezone: string;
    method: number; locationType?: string; isCityOption?: boolean; provinceCode?: string; provinceName?: string;
    parentCity?: string; queryName?: string;
}
export const locations: Location[] = data;
export function listCities(country?: string) {
    return locations.filter(x => x.country === country && (!x.locationType || x.locationType === 'city' || x.isCityOption));
}
export function listAreas(cityId?: string) {
    const city = locations.find(x => x.nameEn === cityId);
    if (!city?.provinceCode) return [];
    return locations.filter(x => x.country === city.country && x.nameEn !== cityId &&
        (x.locationType === 'district' ? x.parentCity === cityId : x.provinceCode === city.provinceCode));
}
export function parentCityId(locationId?: string) {
    const location = locations.find(x => x.nameEn === locationId);
    if (!location) return undefined;
    if (!location.locationType || location.locationType === 'city' || location.isCityOption) return location.nameEn;
    return location.parentCity || listCities(location.country).find(x => x.provinceCode === location.provinceCode)?.nameEn;
}
export function areaLabel(location: Location) {
    const kind = location.locationType === 'district' ? 'مقاطعة' : location.locationType === 'center' ? 'مركز' : 'جماعة';
    return `${location.name} — ${kind}`;
}
