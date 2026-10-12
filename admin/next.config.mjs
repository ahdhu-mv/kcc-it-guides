/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // node:sqlite and child_process are Node built-ins; nothing native to bundle.
};
