export function hasEnabledAdhkarCategory(categories: Record<string, unknown> | null | undefined): boolean {
    return Object.values(categories || {}).some(value => value === true);
}
