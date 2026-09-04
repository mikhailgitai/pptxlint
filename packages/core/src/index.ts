/** Stable package identity used to verify the workspace dependency direction. */
export const CORE_PACKAGE_NAME = "@pptxlint/core" as const;

/** Public core contract version. */
export const CORE_API_VERSION = 1 as const;

export * from "./archive/index.js";
export * from "./baseline/index.js";
export * from "./config/index.js";
export * from "./content-types/index.js";
export * from "./context/index.js";
export * from "./geometry/index.js";
export * from "./lint/index.js";
export * from "./opc/path.js";
export * from "./presentation/index.js";
export * from "./relationships/index.js";
export * from "./rules/index.js";
export * from "./suppressions/index.js";
export * from "./text/index.js";
export * from "./xml/index.js";
