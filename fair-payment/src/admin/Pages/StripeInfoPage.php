<?php
/**
 * Stripe Info page for Fair Payment admin
 *
 * @package FairPayment
 */

namespace FairPayment\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Stripe Info page class
 */
class StripeInfoPage {

	/**
	 * Constructor
	 */
	public function __construct() {
		// No dependencies needed for now
	}

	/**
	 * Render the Stripe info page
	 *
	 * @return void
	 */
	public function render() {
		// Check user permissions
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-payment' ) );
		}

		$options        = get_option( 'fair_payment_options', array() );
		$has_secret_key = ! empty( $options['stripe_secret_key'] );
		?>
		<div class="wrap fair-payment-stripe-info">
			<h1>
				<?php echo esc_html( get_admin_page_title() ); ?>
				<span class="fair-payment-status-indicator <?php echo $options['test_mode'] ? 'inactive' : 'active'; ?>" 
						title="<?php echo $options['test_mode'] ? esc_attr__( 'Test Mode Active', 'fair-payment' ) : esc_attr__( 'Live Mode', 'fair-payment' ); ?>"></span>
			</h1>

			<?php
			if ( $options['test_mode'] ) {
				?>
				<div class="notice notice-warning">
					<p>
						<strong><?php esc_html_e( 'Test Mode Active', 'fair-payment' ); ?></strong>
						<?php esc_html_e( 'Showing test mode data. Switch to live mode to see production information.', 'fair-payment' ); ?>
					</p>
				</div>
				<?php
			}

			if ( ! $has_secret_key ) {
				?>
				<div class="notice notice-error">
					<p>
						<strong><?php esc_html_e( 'Stripe Secret Key Required', 'fair-payment' ); ?></strong>
						<?php esc_html_e( 'Please configure your Stripe secret key in the plugin settings to view account information.', 'fair-payment' ); ?>
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-payment' ) ); ?>" class="button button-primary" style="margin-left: 10px;">
							<?php esc_html_e( 'Go to Settings', 'fair-payment' ); ?>
						</a>
					</p>
				</div>
				<?php
				return;
			}
			?>

			<div class="fair-payment-stripe-dashboard">
				<?php $this->render_account_balance(); ?>
			</div>
		</div>
		<?php
	}

	/**
	 * Render account balance section
	 *
	 * @return void
	 */
	private function render_account_balance() {
		?>
		<div class="card" style="margin-bottom: 20px;">
			<h2 class="title"><?php esc_html_e( 'Account Balance', 'fair-payment' ); ?></h2>
			
			<div id="stripe-balance-container">
				<button type="button" class="button button-primary" id="load-stripe-balance">
					<span class="dashicons dashicons-update" style="margin-right: 5px;"></span>
					<?php esc_html_e( 'Load Balance', 'fair-payment' ); ?>
				</button>
				
				<div id="stripe-balance-results" style="margin-top: 15px;"></div>
			</div>
		</div>
		
		<script>
		document.addEventListener('DOMContentLoaded', function() {
			const loadButton = document.getElementById('load-stripe-balance');
			const resultsContainer = document.getElementById('stripe-balance-results');
			
			if (loadButton) {
				loadButton.addEventListener('click', function() {
					loadButton.disabled = true;
					loadButton.innerHTML = '<span class="dashicons dashicons-update dashicons-spin" style="margin-right: 5px;"></span><?php esc_html_e( 'Loading...', 'fair-payment' ); ?>';
					
					// Make AJAX request to get balance
					fetch('<?php echo esc_url( rest_url( 'fair-payment/v1/stripe-balance' ) ); ?>', {
						method: 'GET',
						headers: {
							'X-WP-Nonce': '<?php echo esc_js( wp_create_nonce( 'wp_rest' ) ); ?>',
							'Content-Type': 'application/json'
						}
					})
					.then(response => response.json())
					.then(data => {
						if (data.success) {
							displayBalance(data.data);
						} else {
							displayError(data.data?.message || '<?php esc_html_e( 'Failed to load balance', 'fair-payment' ); ?>');
						}
					})
					.catch(error => {
						displayError('<?php esc_html_e( 'Network error occurred', 'fair-payment' ); ?>');
					})
					.finally(() => {
						loadButton.disabled = false;
						loadButton.innerHTML = '<span class="dashicons dashicons-update" style="margin-right: 5px;"></span><?php esc_html_e( 'Reload Balance', 'fair-payment' ); ?>';
					});
				});
			}
			
			function displayBalance(balance) {
				let html = '<div class="stripe-balance-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">';
				
				// Available Balance
				if (balance.available && balance.available.length > 0) {
					html += '<div class="balance-card" style="padding: 15px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">';
					html += '<h3 style="margin-top: 0; color: #28a745;"><?php esc_html_e( 'Available', 'fair-payment' ); ?></h3>';
					balance.available.forEach(item => {
						const amount = (item.amount / 100).toFixed(2);
						html += `<div style="margin-bottom: 5px;"><strong>${amount} ${item.currency.toUpperCase()}</strong></div>`;
					});
					html += '</div>';
				}
				
				// Pending Balance
				if (balance.pending && balance.pending.length > 0) {
					html += '<div class="balance-card" style="padding: 15px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">';
					html += '<h3 style="margin-top: 0; color: #ffc107;"><?php esc_html_e( 'Pending', 'fair-payment' ); ?></h3>';
					balance.pending.forEach(item => {
						const amount = (item.amount / 100).toFixed(2);
						html += `<div style="margin-bottom: 5px;"><strong>${amount} ${item.currency.toUpperCase()}</strong></div>`;
					});
					html += '</div>';
				}
				
				// Reserved Balance
				if (balance.reserved && balance.reserved.length > 0) {
					html += '<div class="balance-card" style="padding: 15px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;">';
					html += '<h3 style="margin-top: 0; color: #dc3545;"><?php esc_html_e( 'Reserved', 'fair-payment' ); ?></h3>';
					balance.reserved.forEach(item => {
						const amount = (item.amount / 100).toFixed(2);
						html += `<div style="margin-bottom: 5px;"><strong>${amount} ${item.currency.toUpperCase()}</strong></div>`;
					});
					html += '</div>';
				}
				
				html += '</div>';
				
				// Last updated time
				html += '<p style="margin-top: 15px; color: #666; font-size: 12px;">';
				html += '<?php esc_html_e( 'Last updated:', 'fair-payment' ); ?> ' + new Date().toLocaleString();
				html += '</p>';
				
				resultsContainer.innerHTML = html;
			}
			
			function displayError(message) {
				resultsContainer.innerHTML = '<div class="notice notice-error inline"><p><strong><?php esc_html_e( 'Error:', 'fair-payment' ); ?></strong> ' + message + '</p></div>';
			}
		});
		</script>
		<?php
	}
}