=== Fair User Import ===
Contributors: marcinwosinek
Tags: users, import, csv, bulk-import
Requires at least: 6.7
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html
Text Domain: fair-user-import
Domain Path: /languages

Import users from CSV files with optional group assignment.

== Description ==

Fair User Import provides a comprehensive wizard for importing WordPress users from CSV files. The plugin offers a multi-step process with validation, preview, and optional group assignment.

**Key Features:**

* **CSV Upload** - Drag-and-drop interface for uploading CSV files
* **Field Mapping** - Map CSV columns to WordPress user fields
* **Preview & Edit** - Review and modify user data before import
* **Duplicate Detection** - Identifies existing users and duplicates within the CSV
* **Bulk Operations** - Create new users or update existing ones
* **Group Assignment** - Optionally assign imported users to groups (requires Fair Membership plugin)
* **Validation** - Comprehensive validation of email, username, and other fields
* **Error Handling** - Detailed error reporting for failed imports

**Supported User Fields:**

* Username (required)
* Email (required)
* Display Name
* First Name
* Last Name
* Website URL
* Bio/Description

**Integration:**

* **Fair Membership** - When Fair Membership plugin is active, imported users can be assigned to membership groups

**Perfect For:**

* Migrating users from other platforms
* Bulk user registration for events
* Adding multiple team members at once
* Importing membership lists

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-user-import` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Navigate to Tools → Import Users in the WordPress admin menu.
4. Upload your CSV file and follow the step-by-step wizard.

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== Frequently Asked Questions ==

= What format should my CSV file be? =

The CSV file should have headers in the first row. At minimum, it should contain columns for username and email. You'll be able to map your CSV columns to WordPress user fields during the import process.

= Can I update existing users? =

Yes! The plugin detects existing users (by username or email) and allows you to choose whether to update them, skip them, or create new users.

= Is there a limit on the number of users I can import? =

The plugin limits CSV uploads to 500 rows to ensure reliable processing. For larger imports, split your CSV into multiple files.

= What happens if there are errors during import? =

The plugin validates all data before import and provides detailed error messages. If some users fail to import, you'll receive a summary showing which users were created, updated, skipped, and any errors encountered.

= Does it work with Fair Membership plugin? =

Yes! If Fair Membership plugin is active, you'll see an additional step to assign imported users to membership groups.

== Changelog ==

= 0.1.0 =
* Initial release
* Multi-step import wizard
* CSV upload with validation
* Field mapping
* Preview and edit user data
* Duplicate detection
* Fair Membership integration
