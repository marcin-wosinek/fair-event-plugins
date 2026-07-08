const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "admin/settings/index": path.resolve(
      process.cwd(),
      "src/Admin/settings/index.js",
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
