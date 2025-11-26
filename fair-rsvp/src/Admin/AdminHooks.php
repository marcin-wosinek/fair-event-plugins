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
		// Main menu page - Events list.
		add_menu_page(
			__( 'Fair RSVP', 'fair-rsvp' ),
			__( 'Fair RSVP', 'fair-rsvp' ),
			'manage_options',
			'fair-rsvp',
			array( $this, 'render_admin_page' ),
			'dashicons-groups',
			30
		);

		// Submenu page - Invitations.
		add_submenu_page(
			'fair-rsvp',
			__( 'Invitations', 'fair-rsvp' ),
			__( 'Invitations', 'fair-rsvp' ),
			'manage_options',
			'fair-rsvp-invitations',
			array( $this, 'render_invitations_page' )
		);

		// Submenu page - Attendance confirmation (hidden from menu).
		add_submenu_page(
			null, // No parent = hidden from menu.
			__( 'Confirm Attendance', 'fair-rsvp' ),
			__( 'Confirm Attendance', 'fair-rsvp' ),
			'manage_options',
			'fair-rsvp-attendance',
			array( $this, 'render_attendance_page' )
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
	 * Render invitations list page
	 *
	 * @return void
	 */
	public function render_invitations_page() {
		$invitations_page = new InvitationsListPage();
		$invitations_page->render();
	}

	/**
	 * Render attendance confirmation page
	 *
	 * @return void
	 */
	public function render_attendance_page() {
		$attendance_page = new AttendanceConfirmationPage();
		$attendance_page->render();
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

		// Load events list page scripts.
		if ( 'toplevel_page_fair-rsvp' === $hook ) {
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

				// Set script translations.
				wp_set_script_translations(
					'fair-rsvp-events',
					'fair-rsvp',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load invitations list page scripts.
		if ( 'fair-rsvp_page_fair-rsvp-invitations' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/invitations/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-rsvp-invitations',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/invitations/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				// Set script translations.
				wp_set_script_translations(
					'fair-rsvp-invitations',
					'fair-rsvp',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load attendance confirmation page scripts.
		if ( 'admin_page_fair-rsvp-attendance' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/attendance/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-rsvp-attendance',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/attendance/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				// Set script translations.
				wp_set_script_translations(
					'fair-rsvp-attendance',
					'fair-rsvp',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}
	}
}
