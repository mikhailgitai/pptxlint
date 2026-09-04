import { describe, expect, it } from "vitest";

import { CORE_API_VERSION, CORE_PACKAGE_NAME } from "../src/index.js";

describe("@pptxlint/core workspace skeleton", () => {
  it("exposes the first public lint API version", () => {
    expect(CORE_PACKAGE_NAME).toBe("@pptxlint/core");
    expect(CORE_API_VERSION).toBe(1);
  });
});
