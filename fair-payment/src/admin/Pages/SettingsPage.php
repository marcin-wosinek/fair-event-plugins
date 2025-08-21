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
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
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
			'allowed_currencies',
			__( 'Allowed Currencies', 'fair-payment' ),
			array( $this, 'render_allowed_currencies_field' ),
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
			'allowed_currencies'         => array( 'EUR', 'USD', 'GBP' ),
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

		// Sanitize allowed currencies
		$available_currencies = $this->get_available_currencies();
		$allowed_currencies = array();
		
		if ( isset( $input['allowed_currencies'] ) && is_array( $input['allowed_currencies'] ) ) {
			foreach ( $input['allowed_currencies'] as $currency ) {
				$currency = strtoupper( sanitize_text_field( $currency ) );
				if ( isset( $available_currencies[ $currency ] ) ) {
					$allowed_currencies[] = $currency;
				}
			}
		}
		
		// Ensure at least one currency is selected
		if ( empty( $allowed_currencies ) ) {
			$allowed_currencies = array( 'EUR' );
		}
		
		$sanitized['allowed_currencies'] = array_unique( $allowed_currencies );

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
	 * Enqueue admin assets
	 *
	 * @param string $hook_suffix Current admin page hook suffix.
	 * @return void
	 */
	public function enqueue_admin_assets( $hook_suffix ) {
		// Only load on Fair Payment admin pages
		if ( ! $this->is_fair_payment_admin_page( $hook_suffix ) ) {
			//return;
		}

    $plugin_path = __DIR__ . '/../../../fair-payment.php';
    $asset_file = include( plugin_dir_path( $plugin_path ) . 'build/admin/admin.asset.php' );

		// Enqueue admin JavaScript
		wp_enqueue_script(
			'fair-payment-admin',
			plugins_url( 'build/admin/admin.js', $plugin_path ),
			array( 'wp-api', 'jquery-ui-sortable' ),
			'1.0.0',
			true
		);

		// Enqueue admin CSS
		wp_enqueue_style(
			'fair-payment-admin',
			plugins_url( 'build/admin/admin.css', $plugin_path ),
			array(),
			'1.0.0'
		);

		// Get allowed currencies for admin
		$options = get_option( 'fair_payment_options', array() );
		$allowed_currencies = $options['allowed_currencies'] ?? array( 'EUR', 'USD', 'GBP' );
		$available_currencies = $this->get_available_currencies();
		
		// Filter to only include allowed currencies
		$admin_currencies = array();
		foreach ( $allowed_currencies as $currency_code ) {
			if ( isset( $available_currencies[ $currency_code ] ) ) {
				$admin_currencies[] = array(
					'label' => $available_currencies[ $currency_code ],
					'value' => $currency_code,
				);
			}
		}

		// Localize script with data
		wp_localize_script(
			'fair-payment-admin',
			'fairPaymentAdmin',
			array(
				'apiUrl'            => rest_url( 'fair-payment/v1/test-stripe-connection' ),
				'nonce'             => wp_create_nonce( 'wp_rest' ),
				'allowedCurrencies' => $admin_currencies,
				'strings'           => array(
					'enterSecretKey'         => __( 'Please enter a Stripe secret key', 'fair-payment' ),
					'testingConfiguration'   => __( 'Testing Stripe configuration...', 'fair-payment' ),
					'testing'                => __( 'Testing...', 'fair-payment' ),
					'testSuccessful'         => __( '✓ Stripe Configuration Test Successful!', 'fair-payment' ),
					'testFailed'             => __( '✗ Stripe Configuration Test Failed', 'fair-payment' ),
					'connectionFailed'       => __( 'Failed to connect to test endpoint', 'fair-payment' ),
					'unknownError'           => __( 'Unknown error occurred', 'fair-payment' ),
					'secretKey'              => __( 'Secret Key', 'fair-payment' ),
					'publishableKey'         => __( 'Publishable Key', 'fair-payment' ),
					'valid'                  => __( 'Valid', 'fair-payment' ),
					'invalid'                => __( 'Invalid', 'fair-payment' ),
					'notTested'              => __( 'Not tested', 'fair-payment' ),
					'mode'                   => __( 'Mode', 'fair-payment' ),
					'connectionDetails'      => __( 'Connection Details', 'fair-payment' ),
					'responseTime'           => __( 'Response Time', 'fair-payment' ),
					'availableCurrencies'    => __( 'Available Currencies', 'fair-payment' ),
					'apiVersion'             => __( 'API Version', 'fair-payment' ),
					'noPublishableKey'       => __( 'No publishable key provided', 'fair-payment' ),
					'show'                   => __( 'Show', 'fair-payment' ),
					'hide'                   => __( 'Hide', 'fair-payment' ),
					'showPassword'           => __( 'Show password', 'fair-payment' ),
					'hidePassword'           => __( 'Hide password', 'fair-payment' ),
					'dragToReorder'          => __( 'Drag to reorder', 'fair-payment' ),
					'addCurrency'            => __( 'Add currency', 'fair-payment' ),
					'removeCurrency'         => __( 'Remove currency', 'fair-payment' ),
					'lastCurrencyWarning'    => __( 'At least one currency must be selected.', 'fair-payment' ),
				),
			)
		);
	}

	/**
	 * Check if current page is a Fair Payment admin page
	 *
	 * @param string $hook_suffix Current admin page hook suffix.
	 * @return bool True if it's a Fair Payment admin page.
	 */
	private function is_fair_payment_admin_page( $hook_suffix ) {
		$fair_payment_pages = array(
			'toplevel_page_fair-payment',           // Main settings page
			'fair-payment_page_fair-payment-transactions', // Transactions page
		);

		return in_array( $hook_suffix, $fair_payment_pages, true );
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
	 * Get available currencies
	 *
	 * @return array Available currencies with their labels.
	 */
	private function get_available_currencies() {
		return array(
			'USD' => __( 'US Dollar ($)', 'fair-payment' ),
			'EUR' => __( 'Euro (€)', 'fair-payment' ),
			'GBP' => __( 'British Pound (£)', 'fair-payment' ),
			'CAD' => __( 'Canadian Dollar (C$)', 'fair-payment' ),
			'AUD' => __( 'Australian Dollar (A$)', 'fair-payment' ),
			'JPY' => __( 'Japanese Yen (¥)', 'fair-payment' ),
			'CHF' => __( 'Swiss Franc (CHF)', 'fair-payment' ),
			'SEK' => __( 'Swedish Krona (kr)', 'fair-payment' ),
			'NOK' => __( 'Norwegian Krone (kr)', 'fair-payment' ),
			'DKK' => __( 'Danish Krone (kr)', 'fair-payment' ),
			'PLN' => __( 'Polish Złoty (zł)', 'fair-payment' ),
		);
	}

	/**
	 * Render allowed currencies field
	 *
	 * @return void
	 */
	public function render_allowed_currencies_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		$available_currencies = $this->get_available_currencies();
		$allowed_currencies = $options['allowed_currencies'] ?? array( 'EUR' );
		?>
		<div class="fair-payment-currency-selector">
			<div class="fair-payment-currency-available">
				<h4><?php esc_html_e( 'Available Currencies', 'fair-payment' ); ?></h4>
				<div class="fair-payment-currency-list" id="available-currencies">
					<?php foreach ( $available_currencies as $code => $label ) : ?>
						<?php if ( ! in_array( $code, $allowed_currencies, true ) ) : ?>
							<div class="fair-payment-currency-item" data-currency="<?php echo esc_attr( $code ); ?>">
								<span class="currency-code"><?php echo esc_html( $code ); ?></span>
								<span class="currency-label"><?php echo esc_html( $label ); ?></span>
								<button type="button" class="button button-small add-currency" aria-label="<?php esc_attr_e( 'Add currency', 'fair-payment' ); ?>">
									<span class="dashicons dashicons-plus-alt"></span>
								</button>
							</div>
						<?php endif; ?>
					<?php endforeach; ?>
				</div>
			</div>
			
			<div class="fair-payment-currency-allowed">
				<h4><?php esc_html_e( 'Allowed Currencies', 'fair-payment' ); ?> <small><?php esc_html_e( '(drag to reorder)', 'fair-payment' ); ?></small></h4>
				<div class="fair-payment-currency-list fair-payment-sortable" id="allowed-currencies">
					<?php foreach ( $allowed_currencies as $index => $code ) : ?>
						<?php if ( isset( $available_currencies[ $code ] ) ) : ?>
							<div class="fair-payment-currency-item" data-currency="<?php echo esc_attr( $code ); ?>">
								<span class="dashicons dashicons-menu drag-handle" aria-label="<?php esc_attr_e( 'Drag to reorder', 'fair-payment' ); ?>"></span>
								<span class="currency-code"><?php echo esc_html( $code ); ?></span>
								<span class="currency-label"><?php echo esc_html( $available_currencies[ $code ] ); ?></span>
								<button type="button" class="button button-small remove-currency" aria-label="<?php esc_attr_e( 'Remove currency', 'fair-payment' ); ?>">
									<span class="dashicons dashicons-minus"></span>
								</button>
								<input type="hidden" name="fair_payment_options[allowed_currencies][]" value="<?php echo esc_attr( $code ); ?>" />
							</div>
						<?php endif; ?>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
		
		<p class="description">
			<?php esc_html_e( 'Select and order the currencies that will be available for payments. The first currency will be used as the default. Drag items to reorder.', 'fair-payment' ); ?>
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
		<button type="button" class="button button-secondary fair-payment-password-toggle" aria-label="<?php esc_attr_e( 'Show password', 'fair-payment' ); ?>">
			<?php esc_html_e( 'Show', 'fair-payment' ); ?>
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
		<?php
	}
}
