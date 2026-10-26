/**
 * Every UI string in English, German, French and Italian: [en, de, fr, it].
 * `tests/i18n.test.ts` fails when a string is missing.
 */
export type CatalogRow = readonly [string, string, string, string];

import { ROWS as R_a } from "./catalog-a";
import { ROWS as R_b } from "./catalog-b";
import { ROWS as R_c } from "./catalog-c";
import { ROWS as R_d } from "./catalog-d";
import { ROWS as R_e } from "./catalog-e";
import { ROWS as R_f } from "./catalog-f";
import { ROWS as R_g } from "./catalog-g";
import { ROWS as R_h } from "./catalog-h";
import { ROWS as R_i } from "./catalog-i";
import { ROWS as R_j } from "./catalog-j";
import { ROWS as R_k } from "./catalog-k";
import { ROWS as R_l } from "./catalog-l";

export const CATALOG: CatalogRow[] = [...R_a, ...R_b, ...R_c, ...R_d, ...R_e, ...R_f, ...R_g, ...R_h, ...R_i, ...R_j, ...R_k, ...R_l];
