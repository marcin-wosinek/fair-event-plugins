const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "admin/connections/index": path.resolve(
      process.cwd(),
      "src/Admin/connections/index.js",
    ),
    "admin/instagram-connections/index": path.resolve(
      process.cwd(),
      "src/Admin/instagram-connections/index.js",
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
