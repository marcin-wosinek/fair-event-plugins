<?php
/**
 * Fee Payment Template
 *
 * Public page for paying membership fees via Mollie.
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Services\FeePaymentToken;
use FairAudience\Database\FeePaymentRepository;
use FairAudience\Database\FeeRepository;
use FairAudience\Database\FeeAuditLogRepository;
use FairAudience\Database\FeePaymentTransactionRepository;
use FairAudience\Database\ParticipantRepository;

// Get the token from the query var.
$token = sanitize_text_field( get_query_var( 'fee_payment' ) );

// Initialize repositories.
$payment_repository     = new FeePaymentRepository();
$fee_repository         = new FeeRepository();
$participant_repository = new ParticipantRepository();

// Process the request.
$result = array(
	'success'            => false,
	'message'            => '',
	'type'               => 'error',
	'fee_payment'        => null,
	'fee'                => null,
	'participant'        => null,
	'payment_processing' => false,
);

// Verify token.
$fee_payment_id = FeePaymentToken::verify( $token );

if ( false === $fee_payment_id ) {
	$result['message'] = __( 'Invalid or expired link. Please use the link from your email.', 'fair-audience' );
} else {
	// Get fee payment.
	$fee_payment = $payment_repository->get_by_id( $fee_payment_id );

	if ( ! $fee_payment ) {
		$result['message'] = __( 'Payment not found.', 'fair-audience' );
	} else {
		$fee         = $fee_repository->get_by_id( $fee_payment->fee_id );
		$participant = $participant_repository->get_by_id( $fee_payment->participant_id );

		if ( ! $fee || ! $participant ) {
			$result['message'] = __( 'Payment details not found.', 'fair-audience' );
		} else {
			$result['success']     = true;
			$result['fee_payment'] = $fee_payment;
			$result['fee']         = $fee;
			$result['participant'] = $participant;

			// Check if returning from payment (transaction_id is set but fee_payment still pending).
			if ( $fee_payment->transaction_id && 'pending' === $fee_payment->status ) {
				// Proactively sync with Mollie to get real status.
				$transaction = fair_payment_sync_transaction_status( $fee_payment->transaction_id );
				if ( $transaction && 'paid' === $transaction->status ) {
					// Webhook already updated the transaction but not the fee_payment yet - mark processing.
					$result['payment_processing'] = true;
				} elseif ( $transaction && in_array( $transaction->status, array( 'failed', 'canceled', 'expired' ), true ) ) {
					$result['type']    = 'warning';
					$result['message'] = __( 'Your payment was not completed. You can try again.', 'fair-audience' );
				} elseif ( $transaction && 'pending_payment' === $transaction->status ) {
					// Still pending after sync — check staleness (20 min timeout).
					$initiated_at = strtotime( $transaction->payment_initiated_at );
					$age_minutes  = ( time() - $initiated_at ) / 60;

					if ( $age_minutes > 20 ) {
						$result['type']    = 'warning';
						$result['message'] = __( 'Your previous payment attempt has timed out. You can try again.', 'fair-audience' );
					} else {
						$result['payment_processing'] = true;
					}
				} elseif ( $transaction ) {
					// Other status — show processing.
					$result['payment_processing'] = true;
				}
			}

			// Handle "Pay Now" form submission.
			// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Public form, token provides auth.
			if ( 'POST' === $_SERVER['REQUEST_METHOD'] && isset( $_POST['pay_fee'] ) && 'pending' === $fee_payment->status ) {
				// Create a fair-payment transaction.
				$transaction_id = fair_payment_create_transaction(
					array(
						array(
							'name'     => $fee->name,
							'quantity' => 1,
							'amount'   => (float) $fee_payment->amount,
						),
					),
					array(
						'currency'    => $fee->currency,
						'description' => sprintf(
							/* translators: %s: fee name */
							__( 'Membership fee: %s', 'fair-audience' ),
							$fee->name
						),
						'user_id'     => 0,
						'metadata'    => array(
							'fee_payment_id' => $fee_payment->id,
						),
					)
				);

				if ( is_wp_error( $transaction_id ) ) {
					$result['type']    = 'error';
					$result['message'] = __( 'Could not create payment. Please try again later.', 'fair-audience' );
				} else {
					// Link transaction to fee payment.
					$fee_payment->transaction_id = $transaction_id;
					$fee_payment->save();

					// Record transaction attempt in junction table.
					$transaction_repository = new FeePaymentTransactionRepository();
					$transaction_repository->record_attempt( $fee_payment->id, $transaction_id );

					// Initiate payment with redirect back to this page.
					$redirect_url   = FeePaymentToken::get_url( $fee_payment->id );
					$payment_result = fair_payment_initiate_payment(
						$transaction_id,
						array(
							'redirect_url' => $redirect_url,
						)
					);

					if ( is_wp_error( $payment_result ) ) {
						$result['type']    = 'error';
						$result['message'] = __( 'Could not initiate payment. Please try again later.', 'fair-audience' );
					} else {
						// Redirect to Mollie checkout.
						wp_redirect( $payment_result['checkout_url'] );
						exit;
					}
				}
			}
		}
	}
}

$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<style>
	.fair-audience-fee-payment-container {
		max-width: 600px;
		margin: 60px auto;
		padding: 40px 20px;
	}

	.fair-audience-fee-payment-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-fee-payment-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1e1e1e;
		text-align: center;
	}

	.fair-audience-fee-payment-subtitle {
		font-size: 14px;
		color: #757575;
		margin-bottom: 24px;
		text-align: center;
	}

	.fair-audience-fee-payment-message {
		padding: 12px 16px;
		border-radius: 4px;
		margin-bottom: 24px;
		font-size: 14px;
	}

	.fair-audience-fee-payment-message.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.fair-audience-fee-payment-message.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.fair-audience-fee-payment-message.warning {
		background: #fff3cd;
		color: #856404;
		border: 1px solid #ffeeba;
	}

	.fair-audience-fee-payment-message.info {
		background: #d1ecf1;
		color: #0c5460;
		border: 1px solid #bee5eb;
	}

	.fair-audience-fee-payment-details {
		margin-bottom: 24px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		overflow: hidden;
	}

	.fair-audience-fee-payment-detail-row {
		display: flex;
		padding: 12px 16px;
		border-bottom: 1px solid #e0e0e0;
	}

	.fair-audience-fee-payment-detail-row:last-child {
		border-bottom: none;
	}

	.fair-audience-fee-payment-detail-label {
		font-weight: 600;
		color: #1e1e1e;
		min-width: 120px;
	}

	.fair-audience-fee-payment-detail-value {
		color: #333;
	}

	.fair-audience-fee-payment-amount {
		font-size: 32px;
		font-weight: 700;
		text-align: center;
		color: #1e1e1e;
		margin: 24px 0;
	}

	.fair-audience-fee-payment-submit {
		display: block;
		width: 100%;
		background-color: #0073aa;
		color: #fff;
		border: none;
		padding: 14px 24px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.fair-audience-fee-payment-submit:hover {
		background-color: #005a87;
	}

	.fair-audience-fee-payment-footer {
		margin-top: 24px;
		text-align: center;
	}

	.fair-audience-fee-payment-link {
		color: #0073aa;
		text-decoration: none;
	}

	.fair-audience-fee-payment-link:hover {
		text-decoration: underline;
	}

	.fair-audience-fee-payment-status {
		display: inline-block;
		padding: 4px 12px;
		border-radius: 12px;
		font-size: 13px;
		font-weight: 600;
	}

	.fair-audience-fee-payment-status.paid {
		background: #d4edda;
		color: #155724;
	}

	.fair-audience-fee-payment-status.canceled {
		background: #f8d7da;
		color: #721c24;
	}

	.fair-audience-fee-payment-status.pending {
		background: #fff3cd;
		color: #856404;
	}

	.fair-audience-error-container {
		text-align: center;
	}

	.fair-audience-error-icon {
		font-size: 48px;
		color: #d63638;
		margin-bottom: 20px;
	}

	.fair-audience-success-icon {
		font-size: 48px;
		color: #00a32a;
		margin-bottom: 20px;
		text-align: center;
	}

	.fair-audience-fee-payment-processing {
		text-align: center;
		padding: 20px 0;
	}

	.fair-audience-fee-payment-spinner {
		display: inline-block;
		width: 40px;
		height: 40px;
		border: 4px solid #e0e0e0;
		border-top-color: #0073aa;
		border-radius: 50%;
		animation: fair-audience-spin 0.8s linear infinite;
		margin-bottom: 16px;
	}

	@keyframes fair-audience-spin {
		to { transform: rotate(360deg); }
	}

	.fair-audience-fee-payment-processing-text {
		font-size: 16px;
		color: #555;
		margin: 0;
	}
</style>

<div class="fair-audience-fee-payment-container">
	<div class="fair-audience-fee-payment-box">
		<?php if ( ! $result['success'] ) : ?>
			<div class="fair-audience-error-container">
				<div class="fair-audience-error-icon">&#10007;</div>
				<h1 class="fair-audience-fee-payment-title">
					<?php echo esc_html__( 'Invalid Link', 'fair-audience' ); ?>
				</h1>
				<p class="fair-audience-fee-payment-message error">
					<?php echo esc_html( $result['message'] ); ?>
				</p>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-fee-payment-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php elseif ( 'paid' === $result['fee_payment']->status ) : ?>
			<div class="fair-audience-success-icon">&#10003;</div>
			<h1 class="fair-audience-fee-payment-title">
				<?php echo esc_html__( 'Payment Complete', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-fee-payment-message success">
				<?php echo esc_html__( 'This fee has already been paid. Thank you!', 'fair-audience' ); ?>
			</p>

			<div class="fair-audience-fee-payment-details">
				<div class="fair-audience-fee-payment-detail-row">
					<span class="fair-audience-fee-payment-detail-label"><?php echo esc_html__( 'Fee:', 'fair-audience' ); ?></span>
					<span class="fair-audience-fee-payment-detail-value"><?php echo esc_html( $result['fee']->name ); ?></span>
				</div>
				<div class="fair-audience-fee-payment-detail-row">
					<span class="fair-audience-fee-payment-detail-label"><?php echo esc_html__( 'Amount:', 'fair-audience' ); ?></span>
					<span class="fair-audience-fee-payment-detail-value"><?php echo esc_html( number_format( (float) $result['fee_payment']->amount, 2 ) . ' ' . $result['fee']->currency ); ?></span>
				</div>
				<div class="fair-audience-fee-payment-detail-row">
					<span class="fair-audience-fee-payment-detail-label"><?php echo esc_html__( 'Paid:', 'fair-audience' ); ?></span>
					<span class="fair-audience-fee-payment-detail-value"><?php echo esc_html( $result['fee_payment']->paid_at ); ?></span>
				</div>
			</div>

			<div class="fair-audience-fee-payment-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-fee-payment-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php elseif ( 'canceled' === $result['fee_payment']->status ) : ?>
			<h1 class="fair-audience-fee-payment-title">
				<?php echo esc_html__( 'Payment Canceled', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-fee-payment-message error">
				<?php echo esc_html__( 'This fee payment has been canceled.', 'fair-audience' ); ?>
			</p>
			<div class="fair-audience-fee-payment-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-fee-payment-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php elseif ( $result['payment_processing'] ) : ?>
			<h1 class="fair-audience-fee-payment-title">
				<?php echo esc_html( $result['fee']->name ); ?>
			</h1>

			<div class="fair-audience-fee-payment-amount">
				<?php echo esc_html( number_format( (float) $result['fee_payment']->amount, 2 ) . ' ' . $result['fee']->currency ); ?>
			</div>

			<div class="fair-audience-fee-payment-processing" id="fair-audience-processing">
				<div class="fair-audience-fee-payment-spinner"></div>
				<p class="fair-audience-fee-payment-processing-text">
					<?php echo esc_html__( 'Your payment is being processed...', 'fair-audience' ); ?>
				</p>
			</div>

			<div class="fair-audience-fee-payment-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-fee-payment-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php else : ?>
			<h1 class="fair-audience-fee-payment-title">
				<?php echo esc_html( $result['fee']->name ); ?>
			</h1>
			<p class="fair-audience-fee-payment-subtitle">
				<?php echo esc_html( $result['participant']->name ); ?>
				<?php if ( ! empty( $result['participant']->surname ) ) : ?>
					<?php echo esc_html( $result['participant']->surname ); ?>
				<?php endif; ?>
			</p>

			<?php if ( ! empty( $result['message'] ) ) : ?>
				<div class="fair-audience-fee-payment-message <?php echo esc_attr( $result['type'] ); ?>">
					<?php echo esc_html( $result['message'] ); ?>
				</div>
			<?php endif; ?>

			<div class="fair-audience-fee-payment-amount">
				<?php echo esc_html( number_format( (float) $result['fee_payment']->amount, 2 ) . ' ' . $result['fee']->currency ); ?>
			</div>

			<div class="fair-audience-fee-payment-details">
				<div class="fair-audience-fee-payment-detail-row">
					<span class="fair-audience-fee-payment-detail-label"><?php echo esc_html__( 'Fee:', 'fair-audience' ); ?></span>
					<span class="fair-audience-fee-payment-detail-value"><?php echo esc_html( $result['fee']->name ); ?></span>
				</div>
				<?php if ( ! empty( $result['fee']->due_date ) ) : ?>
				<div class="fair-audience-fee-payment-detail-row">
					<span class="fair-audience-fee-payment-detail-label"><?php echo esc_html__( 'Due Date:', 'fair-audience' ); ?></span>
					<span class="fair-audience-fee-payment-detail-value"><?php echo esc_html( $result['fee']->due_date ); ?></span>
				</div>
				<?php endif; ?>
			</div>

			<form method="post">
				<input type="hidden" name="pay_fee" value="1">
				<button type="submit" class="fair-audience-fee-payment-submit">
					<?php echo esc_html__( 'Pay Now', 'fair-audience' ); ?>
				</button>
			</form>

			<div class="fair-audience-fee-payment-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-fee-payment-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php endif; ?>
	</div>
</div>

<?php if ( $result['payment_processing'] ) : ?>
<script>
	(function() {
		var delays = [3000, 5000, 5000, 10000, 10000, 15000];
		var params = new URLSearchParams(window.location.search);
		var attempt = parseInt(params.get('_check') || '0', 10);

		if (attempt >= delays.length) {
			var el = document.getElementById('fair-audience-processing');
			if (el) {
				el.innerHTML = '<p class="fair-audience-fee-payment-processing-text">' +
					<?php echo wp_json_encode( __( 'Payment is taking longer than expected. Please reload this page to check the status.', 'fair-audience' ) ); ?> +
					'</p>';
			}
			return;
		}

		setTimeout(function() {
			var url = new URL(window.location.href);
			url.searchParams.set('_check', attempt + 1);
			window.location.href = url.toString();
		}, delays[attempt]);
	})();
</script>
<?php endif; ?>

<?php wp_footer(); ?>
</body>
</html>
