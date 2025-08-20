<?php
/**
 * Settings page for Fair Payment admin
 *
 * @package FairPayment
 */

namespace FairPayment\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Settings page class using WordPress Settings API
 */
class SettingsPage {

	/**
	 * Settings group name
	 */
	const SETTINGS_GROUP = 'fair_payment_settings';

	/**
	 * Settings page slug
	 */
	const PAGE_SLUG = 'fair-payment';

	/**
	 * Constructor
	 */
	public function __construct() {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Register settings using WordPress Settings API
	 *
	 * @return void
	 */
	public function register_settings() {
		// Register settings
		register_setting(
			self::SETTINGS_GROUP,
			'fair_payment_options',
			array(
				'sanitize_callback' => array( $this, 'sanitize_settings' ),
				'default'           => $this->get_default_settings(),
			)
		);

		// API Settings Section (first)
		add_settings_section(
			'fair_payment_api',
			__( 'API Settings', 'fair-payment' ),
			array( $this, 'render_api_section' ),
			self::PAGE_SLUG
		);

		// Payment Configuration Section
		add_settings_section(
			'fair_payment_general',
			__( 'Payment Configuration', 'fair-payment' ),
			array( $this, 'render_general_section' ),
			self::PAGE_SLUG
		);

		// Developer Section
		add_settings_section(
			'fair_payment_developer',
			__( 'Developer Settings', 'fair-payment' ),
			array( $this, 'render_developer_section' ),
			self::PAGE_SLUG
		);

		// Add fields to API section (first)
		add_settings_field(
			'stripe_secret_key',
			__( 'Stripe Secret Key', 'fair-payment' ),
			array( $this, 'render_stripe_secret_key_field' ),
			self::PAGE_SLUG,
			'fair_payment_api'
		);

		add_settings_field(
			'stripe_publishable_key',
			__( 'Stripe Publishable Key', 'fair-payment' ),
			array( $this, 'render_stripe_publishable_key_field' ),
			self::PAGE_SLUG,
			'fair_payment_api'
		);

		// Add fields to General section
		add_settings_field(
			'default_currency',
			__( 'Default Currency', 'fair-payment' ),
			array( $this, 'render_currency_field' ),
			self::PAGE_SLUG,
			'fair_payment_general'
		);


		// Add fields to Developer section
		add_settings_field(
			'test_mode',
			__( 'Test Mode', 'fair-payment' ),
			array( $this, 'render_test_mode_field' ),
			self::PAGE_SLUG,
			'fair_payment_developer'
		);

	}

	/**
	 * Get default settings
	 *
	 * @return array Default settings.
	 */
	private function get_default_settings() {
		return array(
			'default_currency'           => 'EUR',
			'stripe_secret_key'          => '',
			'stripe_publishable_key'     => '',
			'test_mode'                  => true,
		);
	}

	/**
	 * Sanitize settings input
	 *
	 * @param array $input Settings input.
	 * @return array Sanitized settings.
	 */
	public function sanitize_settings( $input ) {
		$sanitized = array();

		// Sanitize currency
		$allowed_currencies = array( 'USD', 'EUR', 'GBP' );
		$sanitized['default_currency'] = in_array( $input['default_currency'] ?? '', $allowed_currencies, true ) 
			? $input['default_currency'] 
			: 'EUR';

		// Sanitize Stripe API keys
		$sanitized['stripe_secret_key'] = sanitize_text_field( $input['stripe_secret_key'] ?? '' );
		$sanitized['stripe_publishable_key'] = sanitize_text_field( $input['stripe_publishable_key'] ?? '' );

		// Sanitize test mode boolean
		$sanitized['test_mode'] = ! empty( $input['test_mode'] );

		// Add settings updated notice
		add_settings_error(
			'fair_payment_options',
			'settings_updated',
			__( 'Settings saved successfully.', 'fair-payment' ),
			'success'
		);

		return $sanitized;
	}

	/**
	 * Render the settings page
	 *
	 * @return void
	 */
	public function render() {
		// Check user permissions
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-payment' ) );
		}

		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		?>
		<div class="wrap fair-payment-settings">
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
						<?php esc_html_e( 'No real payments will be processed. Disable test mode when you\'re ready to accept live payments.', 'fair-payment' ); ?>
					</p>
				</div>
				<?php
			}
			?>

			<form method="post" action="options.php" novalidate="novalidate">
				<?php
				settings_fields( self::SETTINGS_GROUP );
				do_settings_sections( self::PAGE_SLUG );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Render general section description
	 *
	 * @return void
	 */
	public function render_general_section() {
		?>
		<p class="section-description">
			<?php esc_html_e( 'Configure the basic payment settings for your site.', 'fair-payment' ); ?>
		</p>
		<?php
	}

	/**
	 * Render API section description
	 *
	 * @return void
	 */
	public function render_api_section() {
		?>
		<p class="section-description">
			<?php esc_html_e( 'Configure your Stripe API credentials for payment processing.', 'fair-payment' ); ?>
		</p>
		<?php
	}

	/**
	 * Render developer section description
	 *
	 * @return void
	 */
	public function render_developer_section() {
		?>
		<p class="section-description">
			<?php esc_html_e( 'Settings for development and debugging.', 'fair-payment' ); ?>
		</p>
		<?php
	}

	/**
	 * Render currency field
	 *
	 * @return void
	 */
	public function render_currency_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		$currencies = array(
			'USD' => __( 'US Dollar ($)', 'fair-payment' ),
			'EUR' => __( 'Euro (€)', 'fair-payment' ),
			'GBP' => __( 'British Pound (£)', 'fair-payment' ),
		);
		?>
		<select name="fair_payment_options[default_currency]" id="default_currency">
			<?php foreach ( $currencies as $code => $label ) : ?>
				<option value="<?php echo esc_attr( $code ); ?>" <?php selected( $options['default_currency'], $code ); ?>>
					<?php echo esc_html( $label ); ?>
				</option>
			<?php endforeach; ?>
		</select>
		<p class="description">
			<?php esc_html_e( 'Default currency for new payment blocks and transactions.', 'fair-payment' ); ?>
		</p>
		<?php
	}


	/**
	 * Render Stripe secret key field
	 *
	 * @return void
	 */
	public function render_stripe_secret_key_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		?>
		<input type="password" name="fair_payment_options[stripe_secret_key]" 
			   id="stripe_secret_key" value="<?php echo esc_attr( $options['stripe_secret_key'] ); ?>" 
			   class="regular-text" autocomplete="off" placeholder="sk_test_... or sk_live_..." />
		<button type="button" class="button button-secondary" onclick="this.previousElementSibling.type = this.previousElementSibling.type === 'password' ? 'text' : 'password';">
			<?php esc_html_e( 'Show/Hide', 'fair-payment' ); ?>
		</button>
		<p class="description">
			<?php esc_html_e( 'Your Stripe secret key (starts with sk_). Keep this secure and never share it publicly.', 'fair-payment' ); ?>
		</p>
		<?php
	}

	/**
	 * Render Stripe publishable key field
	 *
	 * @return void
	 */
	public function render_stripe_publishable_key_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		?>
		<input type="text" name="fair_payment_options[stripe_publishable_key]" 
			   id="stripe_publishable_key" value="<?php echo esc_attr( $options['stripe_publishable_key'] ); ?>" 
			   class="regular-text" placeholder="pk_test_... or pk_live_..." />
		<p class="description">
			<?php esc_html_e( 'Your Stripe publishable key (starts with pk_). This is safe to include in client-side code.', 'fair-payment' ); ?>
		</p>
		
		<div class="fair-payment-comprehensive-test" style="margin-top: 15px; padding: 15px; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px;">
			<h4 style="margin-top: 0;"><?php esc_html_e( 'Test Stripe Configuration', 'fair-payment' ); ?></h4>
			<p class="description" style="margin-bottom: 10px;">
				<?php esc_html_e( 'Test your complete Stripe setup including both API keys, balance access, and mode consistency.', 'fair-payment' ); ?>
			</p>
			<button type="button" class="button button-primary" id="test-comprehensive-stripe-connection">
				<span class="dashicons dashicons-cloud" style="margin-right: 5px;"></span>
				<?php esc_html_e( 'Test Full Configuration', 'fair-payment' ); ?>
			</button>
			<div id="comprehensive-stripe-test-results" style="margin-top: 15px;"></div>
		</div>
		<?php
	}


	/**
	 * Render test mode field
	 *
	 * @return void
	 */
	public function render_test_mode_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		?>
		<fieldset>
			<label for="test_mode">
				<input type="checkbox" name="fair_payment_options[test_mode]" 
					   id="test_mode" value="1" <?php checked( $options['test_mode'] ); ?> />
				<?php esc_html_e( 'Enable test mode', 'fair-payment' ); ?>
			</label>
			<p class="description">
				<?php esc_html_e( 'When enabled, no real payments will be processed. Use this for testing your payment flow.', 'fair-payment' ); ?>
			</p>
		</fieldset>
		<script>
		document.addEventListener('DOMContentLoaded', function() {
			const testButton = document.getElementById('test-comprehensive-stripe-connection');
			if (testButton) {
				testButton.addEventListener('click', function() {
					const secretKey = document.getElementById('stripe_secret_key').value;
					const publishableKey = document.getElementById('stripe_publishable_key').value;
					const resultsDiv = document.getElementById('comprehensive-stripe-test-results');
					const button = this;
					const originalContent = button.innerHTML;
					
					if (!secretKey.trim()) {
						resultsDiv.innerHTML = '<div class="notice notice-error"><p><?php esc_html_e( 'Please enter a Stripe secret key', 'fair-payment' ); ?></p></div>';
						return;
					}
					
					button.disabled = true;
					button.innerHTML = '<span class="dashicons dashicons-update-alt" style="margin-right: 5px; animation: spin 1s linear infinite;"></span><?php esc_html_e( 'Testing...', 'fair-payment' ); ?>';
					resultsDiv.innerHTML = '<div class="notice notice-info"><p><?php esc_html_e( 'Testing Stripe configuration...', 'fair-payment' ); ?></p></div>';
					
					// Call the REST API endpoint
					fetch('<?php echo esc_url( rest_url( 'fair-payment/v1/test-stripe-connection' ) ); ?>', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Nonce': '<?php echo wp_create_nonce( 'wp_rest' ); ?>'
						},
						body: JSON.stringify({
							secret_key: secretKey,
							publishable_key: publishableKey,
							_wpnonce: '<?php echo wp_create_nonce( 'wp_rest' ); ?>'
						})
					})
					.then(response => response.json())
					.then(data => {
						if (data.success) {
							resultsDiv.innerHTML = buildSuccessResults(data.data);
						} else {
							resultsDiv.innerHTML = buildErrorResults(data.data || { message: data.message || 'Unknown error' });
						}
					})
					.catch(error => {
						resultsDiv.innerHTML = '<div class="notice notice-error"><p><?php esc_html_e( 'Failed to connect to test endpoint', 'fair-payment' ); ?>: ' + error.message + '</p></div>';
					})
					.finally(() => {
						button.disabled = false;
						button.innerHTML = originalContent;
					});
				});
			}
			
			function buildSuccessResults(data) {
				let html = '<div class="notice notice-success"><p><strong><?php esc_html_e( '✓ Stripe Configuration Test Successful!', 'fair-payment' ); ?></strong></p></div>';
				
				html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">';
				
				// Secret Key Results
				html += '<div style="background: white; padding: 12px; border-left: 4px solid #46b450; border-radius: 0 4px 4px 0;">';
				html += '<h4 style="margin-top: 0; color: #23282d;"><?php esc_html_e( 'Secret Key', 'fair-payment' ); ?></h4>';
				if (data.secret_key && data.secret_key.valid) {
					html += '<p style="color: #46b450; margin: 5px 0;"><span class="dashicons dashicons-yes-alt"></span> <?php esc_html_e( 'Valid', 'fair-payment' ); ?></p>';
					html += '<p style="margin: 5px 0;"><strong><?php esc_html_e( 'Mode:', 'fair-payment' ); ?></strong> ' + (data.secret_key.mode || 'unknown') + '</p>';
				}
				html += '</div>';
				
				// Publishable Key Results
				html += '<div style="background: white; padding: 12px; border-left: 4px solid ' + (data.publishable_key ? '#46b450' : '#ffb900') + '; border-radius: 0 4px 4px 0;">';
				html += '<h4 style="margin-top: 0; color: #23282d;"><?php esc_html_e( 'Publishable Key', 'fair-payment' ); ?></h4>';
				if (data.publishable_key) {
					if (data.publishable_key.valid) {
						html += '<p style="color: #46b450; margin: 5px 0;"><span class="dashicons dashicons-yes-alt"></span> <?php esc_html_e( 'Valid', 'fair-payment' ); ?></p>';
						html += '<p style="margin: 5px 0;"><strong><?php esc_html_e( 'Mode:', 'fair-payment' ); ?></strong> ' + (data.publishable_key.mode || 'unknown') + '</p>';
					} else {
						html += '<p style="color: #d63638; margin: 5px 0;"><span class="dashicons dashicons-dismiss"></span> <?php esc_html_e( 'Invalid', 'fair-payment' ); ?></p>';
						html += '<p style="margin: 5px 0; color: #d63638;">' + (data.publishable_key.error || '<?php esc_html_e( 'Unknown error', 'fair-payment' ); ?>') + '</p>';
					}
				} else {
					html += '<p style="color: #ffb900; margin: 5px 0;"><span class="dashicons dashicons-warning"></span> <?php esc_html_e( 'Not tested', 'fair-payment' ); ?></p>';
					html += '<p style="margin: 5px 0; font-style: italic;"><?php esc_html_e( 'No publishable key provided', 'fair-payment' ); ?></p>';
				}
				html += '</div>';
				
				html += '</div>';
				
				// Balance & Connection Info
				if (data.balance || data.connection) {
					html += '<div style="background: white; padding: 12px; margin-top: 15px; border-radius: 4px; border: 1px solid #ccd0d4;">';
					html += '<h4 style="margin-top: 0; color: #23282d;"><?php esc_html_e( 'Connection Details', 'fair-payment' ); ?></h4>';
					
					if (data.connection && data.connection.response_time) {
						html += '<p style="margin: 5px 0;"><strong><?php esc_html_e( 'Response Time:', 'fair-payment' ); ?></strong> ' + data.connection.response_time + 'ms</p>';
					}
					
					if (data.balance && data.balance.currencies && data.balance.currencies.length > 0) {
						html += '<p style="margin: 5px 0;"><strong><?php esc_html_e( 'Available Currencies:', 'fair-payment' ); ?></strong> ' + data.balance.currencies.join(', ').toUpperCase() + '</p>';
					}
					
					if (data.connection && data.connection.api_version) {
						html += '<p style="margin: 5px 0;"><strong><?php esc_html_e( 'API Version:', 'fair-payment' ); ?></strong> ' + data.connection.api_version + '</p>';
					}
					
					html += '</div>';
				}
				
				return html;
			}
			
			function buildErrorResults(data) {
				let html = '<div class="notice notice-error"><p><strong><?php esc_html_e( '✗ Stripe Configuration Test Failed', 'fair-payment' ); ?></strong></p>';
				html += '<p>' + (data.message || '<?php esc_html_e( 'Unknown error occurred', 'fair-payment' ); ?>') + '</p></div>';
				
				return html;
			}
		});
		
		// Add CSS for spinning animation
		if (!document.getElementById('fair-payment-admin-styles')) {
			const style = document.createElement('style');
			style.id = 'fair-payment-admin-styles';
			style.textContent = `
				@keyframes spin {
					from { transform: rotate(0deg); }
					to { transform: rotate(360deg); }
				}
				.fair-payment-comprehensive-test .notice {
					margin: 0;
				}
			`;
			document.head.appendChild(style);
		}
		</script>
		<?php
	}
}
