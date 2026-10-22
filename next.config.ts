import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  outputFileTracingIncludes: {
    "/api/expense-notes/receipt-suggestion": ["./scripts/ocr-engine.mjs", "./tessdata/**/*"],
    "/api/receipt-analyses": ["./scripts/ocr-engine.mjs", "./tessdata/**/*"],
  },
  agentRules: false,
};

export default nextConfig;
