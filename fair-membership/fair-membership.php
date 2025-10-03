<?php
/**
 * Plugin Name: Fair Membership
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Membership management plugin.
 * Version: 0.1.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-membership
 *
 * Fair Membership is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Membership is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Membership. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairMembership
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairMembership;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';

use FairMembership\Core\Plugin;
use FairMembership\Database\Installer;

// Plugin activation hook
register_activation_hook( __FILE__, array( Installer::class, 'install' ) );

// Plugin deactivation hook
register_deactivation_hook( __FILE__, function() {
	// Currently no deactivation tasks needed
	error_log( 'Fair Membership: Plugin deactivated' );
} );

// Plugin uninstall is handled by uninstall.php

Plugin::instance()->init();
