/**
 * Minimal JSON Schema validator covering exactly the subset the four
 * extraction schemas use: object/required/properties, array/items/minItems/
 * maxItems, string, and nullable unions like ["string","null"].
 * Kept local so extraction output is validated even when a backend
 * (or a model) returns something shaped almost right.
 */
export function validate(schema, value, path = '$') {
    const errors = [];
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const actual = value === null ? 'null'
        : Array.isArray(value) ? 'array'
            : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number')
                : typeof value;
    if (types.length > 0) {
        const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
        if (!ok) {
            errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
            return errors;
        }
    }
    if (value === null)
        return errors;
    if (actual === 'object' && schema.properties) {
        for (const req of schema.required ?? []) {
            if (!(req in value))
                errors.push(`${path}.${req}: required`);
        }
        for (const [k, sub] of Object.entries(schema.properties)) {
            if (k in value)
                errors.push(...validate(sub, value[k], `${path}.${k}`));
        }
    }
    if (actual === 'array') {
        if (schema.minItems != null && value.length < schema.minItems)
            errors.push(`${path}: fewer than ${schema.minItems} items`);
        if (schema.maxItems != null && value.length > schema.maxItems)
            errors.push(`${path}: more than ${schema.maxItems} items`);
        if (schema.items) {
            value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
        }
    }
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: not in enum`);
    }
    return errors;
}
