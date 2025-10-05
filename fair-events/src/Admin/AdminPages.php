<?php
/**
 * Admin Pages for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering admin menu pages
 */
class AdminPages {
	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Settings page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Fair Events Settings', 'fair-events' ),
			__( 'Settings', 'fair-events' ),
			'manage_options',
			'fair-events-settings',
			array( $this, 'render_settings_page' )
		);

		// Import page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Import Events', 'fair-events' ),
			__( 'Import', 'fair-events' ),
			'manage_options',
			'fair-events-import',
			array( $this, 'render_import_page' )
		);
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		</div>
		<?php
	}

	/**
	 * Render import page
	 *
	 * @return void
	 */
	public function render_import_page() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		</div>
		<?php
	}
}
