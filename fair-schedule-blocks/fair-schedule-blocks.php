<?php
/**
 * Plugin Name: Fair Schedule Blocks
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Fair Schedule Blocks provides WordPress Gutenberg blocks with time-dependent display. 
 * Version: 0.2.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-schedule-blocks
 *
 * Fair Schedule Blocks is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Schedule Blocks is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Schedule Blocks. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairScheduleBlocks
 * @author Marcin Wosinek
 * @since 0.1.0
 */

namespace FairScheduleBlocks;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';

use FairScheduleBlocks\Core\Plugin;

Plugin::instance()->init();
