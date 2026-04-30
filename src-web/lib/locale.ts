// Single hardcoded locale used by every date / time formatter in the
// app. en-GB is deliberate (DD/MM ordering, 24-hour time). If Oatpad
// ever ships beyond a personal app, thread a user-configurable
// setting through here instead of touching the call sites.
export const LOCALE = "en-GB";
