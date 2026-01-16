const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

module.exports = {
  ...defaultConfig,
  entry: {
    "blocks/event-dates/editor": path.resolve(
      process.cwd(),
      "src/blocks/event-dates/editor.js",
    ),
    "blocks/events-list/editor": path.resolve(
      process.cwd(),
      "src/blocks/events-list/editor.js",
    ),
    "blocks/events-calendar/editor": path.resolve(
      process.cwd(),
      "src/blocks/events-calendar/editor.js",
    ),
    "blocks/weekly-schedule/editor": path.resolve(
      process.cwd(),
      "src/blocks/weekly-schedule/editor.js",
    ),
    "blocks/event-proposal/editor": path.resolve(
      process.cwd(),
      "src/blocks/event-proposal/editor.js",
    ),
    "blocks/event-proposal/frontend": path.resolve(
      process.cwd(),
      "src/blocks/event-proposal/frontend.js",
    ),
    "admin/settings/index": path.resolve(
      process.cwd(),
      "src/Admin/settings/index.js",
    ),
    "admin/event-meta/index": path.resolve(
      process.cwd(),
      "src/Admin/event-meta/index.js",
    ),
    "admin/sources/index": path.resolve(
      process.cwd(),
      "src/Admin/sources/index.js",
    ),
    "admin/migration/index": path.resolve(
      process.cwd(),
      "src/Admin/migration/index.js",
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
