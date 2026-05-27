const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  resolve: {
    ...defaultConfig.resolve,
    alias: {
      ...defaultConfig.resolve.alias,
      "@": path.resolve(process.cwd(), "src"),
      "@utils": path.resolve(process.cwd(), "src/utils"),
      "@models": path.resolve(process.cwd(), "src/models"),
    },
  },
  plugins: [
    ...defaultConfig.plugins,
    // Required for translation mapping (build/map.json)
    new BundleOutputPlugin({
      cwd: process.cwd(),
      output: "map.json",
    }),
  ],
};
