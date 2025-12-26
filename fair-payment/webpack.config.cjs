const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "blocks/simple-payment/index": path.resolve(
      process.cwd(),
      "src/blocks/simple-payment/index.js",
    ),
    "blocks/simple-payment/view": path.resolve(
      process.cwd(),
      "src/blocks/simple-payment/view.js",
    ),
    "admin/settings/index": path.resolve(
      process.cwd(),
      "src/Admin/settings/index.js",
    ),
    "admin/transactions/index": path.resolve(
      process.cwd(),
      "src/Admin/transactions/index.js",
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
