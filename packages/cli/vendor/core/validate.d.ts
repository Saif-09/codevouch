/**
 * Minimal JSON Schema validator covering exactly the subset the four
 * extraction schemas use: object/required/properties, array/items/minItems/
 * maxItems, string, and nullable unions like ["string","null"].
 * Kept local so extraction output is validated even when a backend
 * (or a model) returns something shaped almost right.
 */
export declare function validate(schema: any, value: any, path?: string): string[];
