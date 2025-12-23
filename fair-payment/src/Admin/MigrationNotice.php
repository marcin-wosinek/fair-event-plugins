<?php
/**
 * Migration Notice for API Key to OAuth migration
 *
 * @package FairPayment
 */

namespace FairPayment\Admin;

defined( 'WPINC' ) || die;

/**
 * Displays admin notices to guide users migrating from API keys to OAuth
 */
class MigrationNotice {
	/**
	 * Initialize migration notice
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_notices', array( $this, 'show_migration_notice' ) );
	}

	/**
	 * Show migration notice to users with API keys but no OAuth connection
	 *
	 * @return void
	 */
	public function show_migration_notice() {
		// Only show on admin pages
		if ( ! is_admin() ) {
			return;
		}

		// Check if user has API keys configured
		$has_api_keys = ! empty( get_option( 'fair_payment_test_api_key' ) ) ||
						! empty( get_option( 'fair_payment_live_api_key' ) );

		// Check if OAuth is connected
		$has_oauth = get_option( 'fair_payment_mollie_connected', false );

		// Show notice only if API keys exist but OAuth is not connected
		if ( $has_api_keys && ! $has_oauth ) {
			$this->render_migration_notice();
		}
	}

	/**
	 * Render the migration notice
	 *
	 * @return void
	 */
	private function render_migration_notice() {
		$settings_url = admin_url( 'admin.php?page=fair-payment-settings' );
		?>
		<div class="notice notice-warning is-dismissible">
			<h2><?php esc_html_e( 'Action Required: Migrate to Mollie OAuth', 'fair-payment' ); ?></h2>
			<p>
				<strong><?php esc_html_e( 'Your Mollie API keys will be deprecated soon.', 'fair-payment' ); ?></strong>
			</p>
			<p>
				<?php
				echo wp_kses_post(
					sprintf(
						/* translators: 1: opening link tag, 2: closing link tag */
						__( 'Fair Payment is migrating to secure OAuth authentication. This provides better security and enables platform fees. Please %1$sconnect your Mollie account%2$s using the new OAuth method.', 'fair-payment' ),
						'<a href="' . esc_url( $settings_url ) . '">',
						'</a>'
					)
				);
				?>
			</p>
			<p>
				<strong><?php esc_html_e( 'Benefits of OAuth:', 'fair-payment' ); ?></strong>
			</p>
			<ul style="list-style: disc; margin-left: 2em;">
				<li><?php esc_html_e( 'More secure - no API keys stored in your database', 'fair-payment' ); ?></li>
				<li><?php esc_html_e( 'Automatic token refresh - no manual updates needed', 'fair-payment' ); ?></li>
				<li><?php esc_html_e( 'Platform fee support - enables fair-event-plugins.com fee collection', 'fair-payment' ); ?></li>
				<li><?php esc_html_e( 'Test and Live modes work with a single connection', 'fair-payment' ); ?></li>
			</ul>
			<p>
				<a href="<?php echo esc_url( $settings_url ); ?>" class="button button-primary">
					<?php esc_html_e( 'Connect with Mollie Now', 'fair-payment' ); ?>
				</a>
			</p>
			<p style="color: #d63638;">
				<strong><?php esc_html_e( 'Timeline:', 'fair-payment' ); ?></strong>
				<?php esc_html_e( 'API keys will be removed in a future update. Please migrate as soon as possible to avoid service interruption.', 'fair-payment' ); ?>
			</p>
		</div>
		<?php
	}
}
