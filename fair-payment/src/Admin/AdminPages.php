<?php
/**
 * Admin Pages for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Admin;

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
		add_menu_page(
			__( 'Fair Payment Settings', 'fair-payment' ),
			__( 'Fair Payment', 'fair-payment' ),
			'manage_options',
			'fair-payment-settings',
			array( $this, 'render_settings_page' ),
			'dashicons-money-alt',
			30
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
			<p><?php esc_html_e( 'Settings placeholder - to be implemented.', 'fair-payment' ); ?></p>
		</div>
		<?php
	}
}
