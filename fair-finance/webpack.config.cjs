const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "admin/budgets/index": path.resolve(
      process.cwd(),
      "src/Admin/budgets/index.js",
    ),
    "admin/entries/index": path.resolve(
      process.cwd(),
      "src/Admin/entries/index.js",
    ),
    "admin/reconciliation/index": path.resolve(
      process.cwd(),
      "src/Admin/reconciliation/index.js",
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
