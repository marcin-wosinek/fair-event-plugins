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
    "blocks/events-week/editor": path.resolve(
      process.cwd(),
      "src/blocks/events-week/editor.js",
    ),
"blocks/event-proposal/editor": path.resolve(
      process.cwd(),
      "src/blocks/event-proposal/editor.js",
    ),
    "blocks/event-proposal/frontend": path.resolve(
      process.cwd(),
      "src/blocks/event-proposal/frontend.js",
    ),
    "blocks/event-info/editor": path.resolve(
      process.cwd(),
      "src/blocks/event-info/editor.js",
    ),
    "blocks/calendar-button/editor": path.resolve(
      process.cwd(),
      "src/blocks/calendar-button/editor.js",
    ),
    "blocks/calendar-button/frontend": path.resolve(
      process.cwd(),
      "src/blocks/calendar-button/frontend.js",
    ),
    "admin/settings/index": path.resolve(
      process.cwd(),
      "src/Admin/settings/index.js",
    ),
    "admin/event-meta-box/index": path.resolve(
      process.cwd(),
      "src/Admin/event-meta-box/index.js",
    ),
    "admin/calendar/index": path.resolve(
      process.cwd(),
      "src/Admin/calendar/index.js",
    ),
    "admin/manage-event/index": path.resolve(
      process.cwd(),
      "src/Admin/manage-event/index.js",
    ),
    "admin/all-events/index": path.resolve(
      process.cwd(),
      "src/Admin/all-events/index.js",
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
