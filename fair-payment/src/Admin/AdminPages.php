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
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Main transactions page
		add_menu_page(
			__( 'Fair Payment', 'fair-payment' ),
			__( 'Fair Payment', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions',
			array( $this, 'render_transactions_page' ),
			'dashicons-money-alt',
			30
		);

		// Transactions submenu (duplicate to rename main menu item)
		add_submenu_page(
			'fair-payment-transactions',
			__( 'Transactions', 'fair-payment' ),
			__( 'Transactions', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions'
		);

		// Settings submenu
		add_submenu_page(
			'fair-payment-transactions',
			__( 'Settings', 'fair-payment' ),
			__( 'Settings', 'fair-payment' ),
			'manage_options',
			'fair-payment-settings',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Only load on Fair Payment settings page.
		if ( false === strpos( $hook, 'fair-payment-settings' ) ) {
			return;
		}

		$asset_file_path = FAIR_PAYMENT_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

		if ( ! file_exists( $asset_file_path ) ) {
			error_log( 'Fair Payment: Asset file not found at ' . $asset_file_path );
			return;
		}

		$asset_file = include $asset_file_path;

		wp_enqueue_script(
			'fair-payment-settings',
			FAIR_PAYMENT_PLUGIN_URL . 'build/admin/settings/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-payment-settings-root"></div>
		<?php
	}

	/**
	 * Render transactions page
	 *
	 * @return void
	 */
	public function render_transactions_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( __( 'You do not have sufficient permissions to access this page.', 'fair-payment' ) );
		}

		$transactions    = \FairPayment\Models\Transaction::get_all( array( 'limit' => 100 ) );
		$organization_id = get_option( 'fair_payment_organization_id', '' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Payment Transactions', 'fair-payment' ); ?></h1>

			<?php if ( empty( $organization_id ) ) : ?>
				<div class="notice notice-warning">
					<p>
						<?php
						echo wp_kses_post(
							sprintf(
								/* translators: %s: link to settings page */
								__( 'To enable direct links to Mollie transactions, please configure your Organization ID in the <a href="%s">settings</a>.', 'fair-payment' ),
								admin_url( 'admin.php?page=fair-payment-settings' )
							)
						);
						?>
					</p>
				</div>
			<?php endif; ?>

			<?php if ( empty( $transactions ) ) : ?>
				<p><?php esc_html_e( 'No transactions found.', 'fair-payment' ); ?></p>
			<?php else : ?>
				<table class="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'ID', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Mollie ID', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Amount', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Status', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Mode', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Description', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'User', 'fair-payment' ); ?></th>
							<th><?php esc_html_e( 'Date', 'fair-payment' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $transactions as $transaction ) : ?>
							<tr>
								<td><?php echo esc_html( $transaction->id ); ?></td>
								<td>
									<?php if ( ! empty( $transaction->mollie_payment_id ) ) : ?>
										<?php
										$mollie_url = ! empty( $organization_id )
											? sprintf( 'https://my.mollie.com/dashboard/%s/payments/%s', $organization_id, $transaction->mollie_payment_id )
											: sprintf( 'https://www.mollie.com/dashboard/payments/%s', $transaction->mollie_payment_id );
										?>
										<a
											href="<?php echo esc_url( $mollie_url ); ?>"
											target="_blank"
											rel="noopener noreferrer"
											title="<?php esc_attr_e( 'View in Mollie Dashboard', 'fair-payment' ); ?>"
										>
											<code><?php echo esc_html( $transaction->mollie_payment_id ); ?></code>
										</a>
									<?php else : ?>
										<code>-</code>
									<?php endif; ?>
								</td>
								<td>
									<strong><?php echo esc_html( number_format( $transaction->amount, 2 ) ); ?></strong>
									<?php echo esc_html( $transaction->currency ); ?>
								</td>
								<td>
									<?php
									$status_class = '';
									switch ( $transaction->status ) {
										case 'paid':
											$status_class = 'status-paid';
											break;
										case 'failed':
										case 'canceled':
										case 'expired':
											$status_class = 'status-failed';
											break;
										case 'open':
										case 'pending':
											$status_class = 'status-pending';
											break;
									}
									?>
									<span class="<?php echo esc_attr( $status_class ); ?>">
										<?php echo esc_html( ucfirst( $transaction->status ) ); ?>
									</span>
								</td>
								<td>
									<?php
									$mode_class = ! empty( $transaction->testmode ) ? 'mode-test' : 'mode-live';
									$mode_text  = ! empty( $transaction->testmode ) ? __( 'Test', 'fair-payment' ) : __( 'Live', 'fair-payment' );
									?>
									<span class="<?php echo esc_attr( $mode_class ); ?>">
										<?php echo esc_html( $mode_text ); ?>
									</span>
								</td>
								<td><?php echo esc_html( $transaction->description ); ?></td>
								<td>
									<?php
									if ( $transaction->user_id ) {
										$user = get_userdata( $transaction->user_id );
										echo $user ? esc_html( $user->display_name ) : '-';
									} else {
										echo '-';
									}
									?>
								</td>
								<td><?php echo esc_html( $transaction->created_at ); ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<style>
			.status-paid { color: #007017; font-weight: bold; }
			.status-failed { color: #d63638; font-weight: bold; }
			.status-pending { color: #996800; font-weight: bold; }
			.mode-test { color: #996800; font-weight: bold; }
			.mode-live { color: #007017; font-weight: bold; }
		</style>
		<?php
	}
}
