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
    "admin/sources/index": path.resolve(
      process.cwd(),
      "src/Admin/sources/index.js",
    ),
    "admin/source-view/index": path.resolve(
      process.cwd(),
      "src/Admin/source-view/index.js",
    ),
    "admin/migration/index": path.resolve(
      process.cwd(),
      "src/Admin/migration/index.js",
    ),
    "admin/migration-summary/index": path.resolve(
      process.cwd(),
      "src/Admin/migration-summary/index.js",
    ),
    "admin/venues/index": path.resolve(
      process.cwd(),
      "src/Admin/venues/index.js",
    ),
    "admin/manage-invitations/index": path.resolve(
      process.cwd(),
      "src/Admin/manage-invitations/index.js",
    ),
    "admin/event-gallery": path.resolve(
      process.cwd(),
      "src/Admin/event-gallery.js",
    ),
    "admin/media-library-filter": path.resolve(
      process.cwd(),
      "src/Admin/media-library-filter.js",
    ),
    "frontend/event-gallery": path.resolve(
      process.cwd(),
      "src/Frontend/event-gallery/index.js",
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
