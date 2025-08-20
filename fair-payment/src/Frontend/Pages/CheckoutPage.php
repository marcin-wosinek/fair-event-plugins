<?php
/**
 * Checkout page for Fair Payment frontend
 *
 * @package FairPayment
 */

namespace FairPayment\Frontend\Pages;

defined( 'WPINC' ) || die;

/**
 * Checkout page class
 */
class CheckoutPage {

	/**
	 * Payment ID if provided
	 *
	 * @var string|null
	 */
	private $payment_id;

	/**
	 * Constructor
	 *
	 * @param string|null $payment_id Optional payment ID.
	 */
	public function __construct( $payment_id = null ) {
		$this->payment_id = $payment_id;
	}

	/**
	 * Render the checkout page
	 *
	 * @return void
	 */
	public function render() {
		$this->render_header();
		$this->render_content();
		$this->render_footer();
	}

	/**
	 * Render HTML header
	 *
	 * @return void
	 */
	private function render_header() {
		?>
		<!DOCTYPE html>
		<html <?php language_attributes(); ?>>
		<head>
			<meta charset="<?php bloginfo( 'charset' ); ?>">
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<title><?php echo esc_html__( 'Checkout', 'fair-payment' ); ?> | <?php bloginfo( 'name' ); ?></title>
			<?php wp_head(); ?>
		</head>
		<body class="fair-payment-checkout">
		<?php
	}

	/**
	 * Render page content
	 *
	 * @return void
	 */
	private function render_content() {
		?>
		<div class="fair-payment-container">
			<div class="fair-payment-header">
				<h1><?php echo esc_html__( 'Fair Payment Checkout', 'fair-payment' ); ?></h1>
				<p><?php echo esc_html__( 'Complete your payment securely', 'fair-payment' ); ?></p>
				
				<?php if ( $this->payment_id ) : ?>
					<p class="payment-id">
						<?php printf( esc_html__( 'Payment ID: %s', 'fair-payment' ), '<code>' . esc_html( $this->payment_id ) . '</code>' ); ?>
					</p>
				<?php endif; ?>
			</div>

			<div class="fair-payment-form">
				<form id="fair-payment-checkout-form" method="post" action="<?php echo esc_url( site_url( '/fair-payment/result' ) ); ?>">
					<?php wp_nonce_field( 'fair_payment_checkout', 'fair_payment_nonce' ); ?>
					
					<?php if ( $this->payment_id ) : ?>
						<input type="hidden" name="payment_id" value="<?php echo esc_attr( $this->payment_id ); ?>" />
					<?php endif; ?>

					<h2><?php echo esc_html__( 'Payment Details', 'fair-payment' ); ?></h2>
					
					<div class="payment-summary">
						<div class="summary-row">
							<span class="label"><?php echo esc_html__( 'Amount:', 'fair-payment' ); ?></span>
							<span class="value">€50.00</span>
						</div>
						<div class="summary-row">
							<span class="label"><?php echo esc_html__( 'Processing Fee:', 'fair-payment' ); ?></span>
							<span class="value">€2.50</span>
						</div>
						<div class="summary-row total">
							<span class="label"><?php echo esc_html__( 'Total:', 'fair-payment' ); ?></span>
							<span class="value">€52.50</span>
						</div>
					</div>

					<h2><?php echo esc_html__( 'Contact Information', 'fair-payment' ); ?></h2>
					
					<label for="customer_email">
						<?php echo esc_html__( 'Email Address', 'fair-payment' ); ?>
						<span class="required">*</span>
					</label>
					<input 
						type="email" 
						id="customer_email" 
						name="customer_email" 
						required 
						placeholder="<?php echo esc_attr__( 'your@email.com', 'fair-payment' ); ?>"
					/>

					<label for="customer_name">
						<?php echo esc_html__( 'Full Name', 'fair-payment' ); ?>
						<span class="required">*</span>
					</label>
					<input 
						type="text" 
						id="customer_name" 
						name="customer_name" 
						required 
						placeholder="<?php echo esc_attr__( 'John Doe', 'fair-payment' ); ?>"
					/>

					<h2><?php echo esc_html__( 'Payment Method', 'fair-payment' ); ?></h2>
					
					<div class="payment-methods">
						<label class="payment-method">
							<input type="radio" name="payment_method" value="card" checked />
							<span><?php echo esc_html__( 'Credit/Debit Card', 'fair-payment' ); ?></span>
						</label>
						
						<label class="payment-method">
							<input type="radio" name="payment_method" value="paypal" />
							<span><?php echo esc_html__( 'PayPal', 'fair-payment' ); ?></span>
						</label>
						
						<label class="payment-method">
							<input type="radio" name="payment_method" value="bank_transfer" />
							<span><?php echo esc_html__( 'Bank Transfer', 'fair-payment' ); ?></span>
						</label>
					</div>

					<div class="card-details" id="card-details">
						<label for="card_number">
							<?php echo esc_html__( 'Card Number', 'fair-payment' ); ?>
						</label>
						<input 
							type="text" 
							id="card_number" 
							name="card_number" 
							placeholder="**** **** **** ****"
							pattern="[0-9\s]{13,19}"
						/>

						<div class="card-row">
							<div class="card-col">
								<label for="card_expiry">
									<?php echo esc_html__( 'Expiry Date', 'fair-payment' ); ?>
								</label>
								<input 
									type="text" 
									id="card_expiry" 
									name="card_expiry" 
									placeholder="MM/YY"
									pattern="[0-9]{2}/[0-9]{2}"
								/>
							</div>
							<div class="card-col">
								<label for="card_cvc">
									<?php echo esc_html__( 'CVC', 'fair-payment' ); ?>
								</label>
								<input 
									type="text" 
									id="card_cvc" 
									name="card_cvc" 
									placeholder="123"
									pattern="[0-9]{3,4}"
								/>
							</div>
						</div>
					</div>

					<div class="form-actions">
						<button type="submit" class="fair-payment-button">
							<?php echo esc_html__( 'Complete Payment', 'fair-payment' ); ?>
						</button>
						
						<p class="security-notice">
							<?php echo esc_html__( '🔒 Your payment information is secure and encrypted', 'fair-payment' ); ?>
						</p>
					</div>
				</form>
			</div>

			<div class="fair-payment-footer">
				<p>
					<?php 
					printf( 
						esc_html__( 'Powered by %s', 'fair-payment' ),
						'<strong>' . esc_html__( 'Fair Payment', 'fair-payment' ) . '</strong>'
					); 
					?>
				</p>
			</div>
		</div>

		<script>
		document.addEventListener('DOMContentLoaded', function() {
			const paymentMethods = document.querySelectorAll('input[name="payment_method"]');
			const cardDetails = document.getElementById('card-details');
			
			paymentMethods.forEach(function(method) {
				method.addEventListener('change', function() {
					if (this.value === 'card') {
						cardDetails.style.display = 'block';
					} else {
						cardDetails.style.display = 'none';
					}
				});
			});
		});
		</script>
		
		<style>
		.payment-summary {
			background: #f9f9f9;
			padding: 1rem;
			border-radius: 4px;
			margin-bottom: 2rem;
		}
		.summary-row {
			display: flex;
			justify-content: space-between;
			margin-bottom: 0.5rem;
		}
		.summary-row.total {
			font-weight: bold;
			font-size: 1.2em;
			border-top: 1px solid #ddd;
			padding-top: 0.5rem;
			margin-top: 1rem;
		}
		.payment-methods {
			margin-bottom: 2rem;
		}
		.payment-method {
			display: block;
			margin-bottom: 1rem;
			cursor: pointer;
		}
		.payment-method input {
			margin-right: 0.5rem;
			width: auto;
		}
		.card-details {
			background: #f9f9f9;
			padding: 1rem;
			border-radius: 4px;
			margin-bottom: 2rem;
		}
		.card-row {
			display: flex;
			gap: 1rem;
		}
		.card-col {
			flex: 1;
		}
		.form-actions {
			text-align: center;
		}
		.security-notice {
			color: #666;
			font-size: 0.9em;
			margin-top: 1rem;
		}
		.required {
			color: red;
		}
		.fair-payment-footer {
			text-align: center;
			margin-top: 2rem;
			padding-top: 1rem;
			border-top: 1px solid #ddd;
			color: #666;
		}
		</style>
		<?php
	}

	/**
	 * Render HTML footer
	 *
	 * @return void
	 */
	private function render_footer() {
		?>
		<?php wp_footer(); ?>
		</body>
		</html>
		<?php
	}
}