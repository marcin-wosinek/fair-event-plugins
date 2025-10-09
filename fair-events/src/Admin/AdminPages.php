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
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
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
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Only load on Fair Events admin pages.
		if ( 'fair_event_page_fair-events-settings' !== $hook && 'fair_event_page_fair-events-import' !== $hook ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

		if ( 'fair_event_page_fair-events-settings' === $hook ) {
			wp_enqueue_script(
				'fair-events-settings',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-settings',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-events-settings-root"></div>
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
