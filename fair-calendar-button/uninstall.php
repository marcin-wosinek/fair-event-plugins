<?php
/**
 * Uninstall script for Fair Calendar Button
 *
 * This file is executed when the plugin is uninstalled via the WordPress admin.
 * It cleans up any data that the plugin may have stored.
 *
 * @package FairCalendarButton
 * @since 1.0.0
 */

// If uninstall not called from WordPress, then exit.
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// The plugin doesn't store any data in the database or create any files,
// so there's nothing to clean up. This file exists for completeness
// and future-proofing in case cleanup is needed in future versions.

// If future versions add options or database tables, clean them up here:
// delete_option('fair_calendar_button_option_name');
// delete_site_option('fair_calendar_button_network_option_name');

// For multisite installations:
// if (is_multisite()) {
//     $sites = get_sites();
//     foreach ($sites as $site) {
//         switch_to_blog($site->blog_id);
//         delete_option('fair_calendar_button_option_name');
//         restore_current_blog();
//     }
// }