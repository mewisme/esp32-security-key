/** The five visible steps of the application-only update page (pages/Update.tsx); text is in i18n `update.steps`. */
export const UPDATE_STEPS = ["connect", "check", "review", "update", "verify"] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];
