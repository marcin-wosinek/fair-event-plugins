<?php
/**
 * Admin hooks for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress admin hooks and pages
 */
class AdminHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		// Placeholder for admin menu registration
		add_menu_page(
			__( 'Fair RSVP', 'fair-rsvp' ),
			__( 'Fair RSVP', 'fair-rsvp' ),
			'manage_options',
			'fair-rsvp',
			array( $this, 'render_admin_page' ),
			'dashicons-groups',
			30
		);
	}

	/**
	 * Render admin page
	 *
	 * @return void
	 */
	public function render_admin_page() {
		$events_page = new EventsListPage();
		$events_page->render();
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Only load on Fair RSVP admin page.
		if ( 'toplevel_page_fair-rsvp' !== $hook ) {
			return;
		}

		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );
		$asset_file = $plugin_dir . 'build/admin/events/index.asset.php';

		if ( file_exists( $asset_file ) ) {
			$asset_data = include $asset_file;

			wp_enqueue_script(
				'fair-rsvp-events',
				plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/events/index.js',
				$asset_data['dependencies'],
				$asset_data['version'],
				true
			);

			// Set script translations
			wp_set_script_translations(
				'fair-rsvp-events',
				'fair-rsvp',
				$plugin_dir . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}
	}
}
