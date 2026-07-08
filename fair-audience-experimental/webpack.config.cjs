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
    "admin/timeline/index": path.resolve(
      process.cwd(),
      "src/Admin/timeline/index.js",
    ),
    "admin/import/index": path.resolve(
      process.cwd(),
      "src/Admin/import/index.js",
    ),
    "admin/polls-list/index": path.resolve(
      process.cwd(),
      "src/Admin/polls-list/index.js",
    ),
    "admin/edit-poll/index": path.resolve(
      process.cwd(),
      "src/Admin/edit-poll/index.js",
    ),
    "admin/collaborators/index": path.resolve(
      process.cwd(),
      "src/Admin/collaborators/index.js",
    ),
    "admin/instagram-posts/index": path.resolve(
      process.cwd(),
      "src/Admin/instagram-posts/index.js",
    ),
    "admin/image-templates/index": path.resolve(
      process.cwd(),
      "src/Admin/image-templates/index.js",
    ),
    "admin/weekly-schedule/index": path.resolve(
      process.cwd(),
      "src/Admin/weekly-schedule/index.js",
    ),
    "admin/fees-list/index": path.resolve(
      process.cwd(),
      "src/Admin/fees-list/index.js",
    ),
    "admin/fee-detail/index": path.resolve(
      process.cwd(),
      "src/Admin/fee-detail/index.js",
    ),
    "admin/groups/index": path.resolve(
      process.cwd(),
      "src/Admin/groups/index.js",
    ),
    "admin/group-detail/index": path.resolve(
      process.cwd(),
      "src/Admin/group-detail/index.js",
    ),
    "admin/custom-mail/index": path.resolve(
      process.cwd(),
      "src/Admin/custom-mail/index.js",
    ),
    "admin/extra-messages-list/index": path.resolve(
      process.cwd(),
      "src/Admin/extra-messages-list/index.js",
    ),
    "admin/edit-extra-message/index": path.resolve(
      process.cwd(),
      "src/Admin/edit-extra-message/index.js",
    ),
    "admin/media-library-filter": path.resolve(
      process.cwd(),
      "src/Admin/media-library-filter.js",
    ),
    "public/poll-response/index": path.resolve(
      process.cwd(),
      "src/public/poll-response/index.js",
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
