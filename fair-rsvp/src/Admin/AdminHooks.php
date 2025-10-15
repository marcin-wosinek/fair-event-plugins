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
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<p><?php esc_html_e( 'RSVP management coming soon.', 'fair-rsvp' ); ?></p>
		</div>
		<?php
	}
}
