// viewScriptModule (events-week's Interactivity API store) only builds when
// this experimental flag is on — wp-scripts otherwise silently ignores it
// and returns a single scriptConfig instead of [scriptConfig, moduleConfig].
process.env.WP_EXPERIMENTAL_MODULES =
  process.env.WP_EXPERIMENTAL_MODULES || "true";

const raw = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

// A block.json with a "module" field (e.g. viewScriptModule) flips
// wp-scripts into a dual [scriptConfig, moduleConfig] export — moduleConfig
// auto-discovers module entries (like events-week's view.js) from block.json,
// so it's passed through as-is. Only the classic scriptConfig gets our
// explicit entry map and BundleOutputPlugin.
const [defaultConfig, moduleConfig] = Array.isArray(raw) ? raw : [raw, null];

const scriptConfig = {
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
    "blocks/event-signup/editor": path.resolve(
      process.cwd(),
      "src/blocks/event-signup/editor.js",
    ),
    "blocks/event-signup/frontend": path.resolve(
      process.cwd(),
      "src/blocks/event-signup/frontend.js",
    ),
    "blocks/get-tickets/editor": path.resolve(
      process.cwd(),
      "src/blocks/get-tickets/editor.js",
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

module.exports = moduleConfig ? [scriptConfig, moduleConfig] : scriptConfig;
