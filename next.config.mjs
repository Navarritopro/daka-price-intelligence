/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/opportunities/export": ["./node_modules/pdfkit/js/data/*.afm"],
    "/api/opportunities/telegram": ["./node_modules/pdfkit/js/data/*.afm"]
  }
};

export default nextConfig;
