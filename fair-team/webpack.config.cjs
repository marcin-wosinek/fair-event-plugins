const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const path = require("path");
const BundleOutputPlugin = require("webpack-bundle-output");

// Get default entries
const defaultEntries = defaultConfig.entry();

// Custom configuration
const customConfig = {
  ...defaultConfig,
  entry: () => ({
    ...defaultEntries,
    // Admin scripts
    "admin/team-admin": path.resolve(process.cwd(), "src/Admin/team-admin.js"),
    "admin/settings/index": path.resolve(
      process.cwd(),
      "src/Admin/settings/index.js"
    ),
  }),
  plugins: [
    ...defaultConfig.plugins,
    // Required for translation mapping
    new BundleOutputPlugin({
      cwd: process.cwd(),
      output: "map.json",
    }),
  ],
};

module.exports = customConfig;
