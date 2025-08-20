<?php
/**
 * Settings page for Fair Payment admin
 *
 * @package FairPayment
 */

namespace FairPayment\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Settings page class
 */
class SettingsPage {

	/**
	 * Render the settings page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Fair Payment Settings', 'fair-payment' ); ?></h1>
			
			<div class="card">
				<h2><?php echo esc_html__( 'Payment Configuration', 'fair-payment' ); ?></h2>
				<p><?php echo esc_html__( 'Configure your payment settings here.', 'fair-payment' ); ?></p>
				
				<form method="post" action="options.php">
					<?php
					settings_fields( 'fair_payment_settings' );
					do_settings_sections( 'fair_payment_settings' );
					?>
					
					<table class="form-table">
						<tr>
							<th scope="row">
								<label for="fair_payment_api_key">
									<?php echo esc_html__( 'API Key', 'fair-payment' ); ?>
								</label>
							</th>
							<td>
								<input type="password" id="fair_payment_api_key" name="fair_payment_api_key" 
									   value="<?php echo esc_attr( get_option( 'fair_payment_api_key', '' ) ); ?>" 
									   class="regular-text" />
								<p class="description">
									<?php echo esc_html__( 'Your payment provider API key.', 'fair-payment' ); ?>
								</p>
							</td>
						</tr>
						
						<tr>
							<th scope="row">
								<label for="fair_payment_currency">
									<?php echo esc_html__( 'Default Currency', 'fair-payment' ); ?>
								</label>
							</th>
							<td>
								<select id="fair_payment_currency" name="fair_payment_currency">
									<?php
									$current_currency = get_option( 'fair_payment_currency', 'EUR' );
									$currencies = array(
										'USD' => 'USD ($)',
										'EUR' => 'EUR (€)',
										'GBP' => 'GBP (£)',
									);
									
									foreach ( $currencies as $code => $label ) {
										printf(
											'<option value="%s" %s>%s</option>',
											esc_attr( $code ),
											selected( $current_currency, $code, false ),
											esc_html( $label )
										);
									}
									?>
								</select>
								<p class="description">
									<?php echo esc_html__( 'Default currency for new payment blocks.', 'fair-payment' ); ?>
								</p>
							</td>
						</tr>
					</table>
					
					<?php submit_button(); ?>
				</form>
			</div>
			
			<div class="card">
				<h2><?php echo esc_html__( 'Test Mode', 'fair-payment' ); ?></h2>
				<p><?php echo esc_html__( 'Use test mode to try payments without real transactions.', 'fair-payment' ); ?></p>
				
				<label>
					<input type="checkbox" name="fair_payment_test_mode" 
						   <?php checked( get_option( 'fair_payment_test_mode', false ) ); ?> />
					<?php echo esc_html__( 'Enable test mode', 'fair-payment' ); ?>
				</label>
			</div>
		</div>
		<?php
	}
}