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
    "admin/compare-events/index": path.resolve(
      process.cwd(),
      "src/Admin/compare-events/index.js",
    ),
    "admin/sources/index": path.resolve(
      process.cwd(),
      "src/Admin/sources/index.js",
    ),
    "admin/source-view/index": path.resolve(
      process.cwd(),
      "src/Admin/source-view/index.js",
    ),
    "admin/duplicate-event/index": path.resolve(
      process.cwd(),
      "src/Admin/duplicate-event/index.js",
    ),
    "admin/merge-event/index": path.resolve(
      process.cwd(),
      "src/Admin/merge-event/index.js",
    ),
    "admin/manage-event-ext/index": path.resolve(
      process.cwd(),
      "src/Admin/manage-event-ext/index.js",
    ),
    "admin/manage-event-schedule/index": path.resolve(
      process.cwd(),
      "src/Admin/manage-event-schedule/index.js",
    ),
    "frontend/meta-attribution": path.resolve(
      process.cwd(),
      "src/Frontend/meta-attribution.js",
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
