const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "admin/api-tokens/index": path.resolve(
      process.cwd(),
      "src/Admin/api-tokens/index.js",
    ),
    "admin/connected-sites/index": path.resolve(
      process.cwd(),
      "src/Admin/connected-sites/index.js",
    ),
  },
  plugins: [
    ...defaultConfig.plugins,
    new BundleOutputPlugin({
      cwd: process.cwd(),
      output: "map.json",
    }),
  ],
};
