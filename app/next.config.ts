import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // OCR, PDF rendering and image tools load native code and worker scripts from node_modules.
  serverExternalPackages: ["tesseract.js", "pdf-to-img", "pdfjs-dist", "@napi-rs/canvas", "sharp"],
  // Bundle the sample faxes, seed patients and the OCR model read at runtime.
  outputFileTracingIncludes: { "/**/*": ["./test-data/**/*", "./node_modules/@tesseract.js-data/eng/**/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
