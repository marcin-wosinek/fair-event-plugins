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

		// Payment Configuration Section
		add_settings_section(
			'fair_payment_general',
			__( 'Payment Configuration', 'fair-payment' ),
			array( $this, 'render_general_section' ),
			self::PAGE_SLUG
		);

		// API Settings Section
		add_settings_section(
			'fair_payment_api',
			__( 'API Settings', 'fair-payment' ),
			array( $this, 'render_api_section' ),
			self::PAGE_SLUG
		);

		// Developer Section
		add_settings_section(
			'fair_payment_developer',
			__( 'Developer Settings', 'fair-payment' ),
			array( $this, 'render_developer_section' ),
			self::PAGE_SLUG
		);

		// Add fields to General section
		add_settings_field(
			'default_currency',
			__( 'Default Currency', 'fair-payment' ),
			array( $this, 'render_currency_field' ),
			self::PAGE_SLUG,
			'fair_payment_general'
		);


		// Add fields to API section
		add_settings_field(
			'api_key',
			__( 'API Key', 'fair-payment' ),
			array( $this, 'render_api_key_field' ),
			self::PAGE_SLUG,
			'fair_payment_api'
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
			'default_currency' => 'EUR',
			'api_key'          => '',
			'test_mode'        => true,
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

		// Sanitize API key
		$sanitized['api_key'] = sanitize_text_field( $input['api_key'] ?? '' );

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
			<?php esc_html_e( 'Configure API credentials for your payment provider.', 'fair-payment' ); ?>
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
	 * Render API key field
	 *
	 * @return void
	 */
	public function render_api_key_field() {
		$options = get_option( 'fair_payment_options', $this->get_default_settings() );
		?>
		<input type="password" name="fair_payment_options[api_key]" 
			   id="api_key" value="<?php echo esc_attr( $options['api_key'] ); ?>" 
			   class="regular-text" autocomplete="off" />
		<button type="button" class="button button-secondary" onclick="this.previousElementSibling.type = this.previousElementSibling.type === 'password' ? 'text' : 'password';">
			<?php esc_html_e( 'Show/Hide', 'fair-payment' ); ?>
		</button>
		<div class="fair-payment-api-test">
			<button type="button" class="button button-secondary" id="test-api-connection">
				<?php esc_html_e( 'Test Connection', 'fair-payment' ); ?>
			</button>
			<span id="api-test-result"></span>
		</div>
		<p class="description">
			<?php esc_html_e( 'Your payment provider API key. Keep this secure and never share it publicly.', 'fair-payment' ); ?>
		</p>
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
