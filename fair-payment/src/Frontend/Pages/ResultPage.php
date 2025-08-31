<?php
/**
 * Result page for Fair Payment frontend
 *
 * @package FairPayment
 */

namespace FairPayment\Frontend\Pages;

defined( 'WPINC' ) || die;

/**
 * Result page class
 */
class ResultPage {

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
	 * Render the result page
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
			<title><?php echo esc_html__( 'Payment Result', 'fair-payment' ); ?> | <?php bloginfo( 'name' ); ?></title>
			<?php wp_head(); ?>
		</head>
		<body class="fair-payment-result">
		<?php
	}

	/**
	 * Render page content
	 *
	 * @return void
	 */
	private function render_content() {
		// Simulate different payment statuses for demonstration
		$status = $this->get_payment_status();
		?>
		<div class="fair-payment-container">
			<div class="fair-payment-header">
				<h1><?php echo esc_html__( 'Payment Result', 'fair-payment' ); ?></h1>
			</div>

			<?php $this->render_status_message( $status ); ?>

			<div class="payment-details">
				<h2><?php echo esc_html__( 'Transaction Details', 'fair-payment' ); ?></h2>
				
				<div class="details-grid">
					<?php if ( $this->payment_id ) : ?>
						<div class="detail-row">
							<span class="label"><?php echo esc_html__( 'Payment ID:', 'fair-payment' ); ?></span>
							<span class="value"><code><?php echo esc_html( $this->payment_id ); ?></code></span>
						</div>
					<?php endif; ?>
					
					<div class="detail-row">
						<span class="label"><?php echo esc_html__( 'Transaction ID:', 'fair-payment' ); ?></span>
						<span class="value"><code><?php echo esc_html( $this->generate_transaction_id() ); ?></code></span>
					</div>
					
					<div class="detail-row">
						<span class="label"><?php echo esc_html__( 'Amount:', 'fair-payment' ); ?></span>
						<span class="value">€52.50</span>
					</div>
					
					<div class="detail-row">
						<span class="label"><?php echo esc_html__( 'Status:', 'fair-payment' ); ?></span>
						<span class="value status-<?php echo esc_attr( $status ); ?>">
							<?php echo esc_html( ucfirst( $status ) ); ?>
						</span>
					</div>
					
					<div class="detail-row">
						<span class="label"><?php echo esc_html__( 'Date:', 'fair-payment' ); ?></span>
						<span class="value"><?php echo esc_html( current_time( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) ) ); ?></span>
					</div>
					
					<?php if ( $status === 'completed' ) : ?>
						<div class="detail-row">
							<span class="label"><?php echo esc_html__( 'Payment Method:', 'fair-payment' ); ?></span>
							<span class="value"><?php echo esc_html__( 'Credit Card (**** 4242)', 'fair-payment' ); ?></span>
						</div>
					<?php endif; ?>
				</div>
			</div>

			<?php if ( $status === 'completed' ) : ?>
				<div class="receipt-section">
					<h2><?php echo esc_html__( 'Receipt', 'fair-payment' ); ?></h2>
					<p><?php echo esc_html__( 'A receipt has been sent to your email address.', 'fair-payment' ); ?></p>
					
					<div class="receipt-actions">
						<button class="fair-payment-button" onclick="window.print()">
							<?php echo esc_html__( 'Print Receipt', 'fair-payment' ); ?>
						</button>
						<a href="<?php echo esc_url( $this->get_receipt_download_url() ); ?>" class="fair-payment-button secondary">
							<?php echo esc_html__( 'Download PDF', 'fair-payment' ); ?>
						</a>
					</div>
				</div>
			<?php endif; ?>

			<div class="action-section">
				<h2><?php echo esc_html__( 'What\'s Next?', 'fair-payment' ); ?></h2>
				
				<?php if ( $status === 'completed' ) : ?>
					<p><?php echo esc_html__( 'Your payment has been processed successfully. You should receive a confirmation email shortly.', 'fair-payment' ); ?></p>
					<div class="actions">
						<a href="<?php echo esc_url( home_url() ); ?>" class="fair-payment-button">
							<?php echo esc_html__( 'Return to Homepage', 'fair-payment' ); ?>
						</a>
						<a href="mailto:support@example.com" class="fair-payment-button secondary">
							<?php echo esc_html__( 'Contact Support', 'fair-payment' ); ?>
						</a>
					</div>
				<?php elseif ( $status === 'pending' ) : ?>
					<p><?php echo esc_html__( 'Your payment is being processed. Please wait while we confirm your transaction.', 'fair-payment' ); ?></p>
					<div class="actions">
						<button class="fair-payment-button" onclick="location.reload()">
							<?php echo esc_html__( 'Refresh Status', 'fair-payment' ); ?>
						</button>
						<a href="<?php echo esc_url( home_url() ); ?>" class="fair-payment-button secondary">
							<?php echo esc_html__( 'Return to Homepage', 'fair-payment' ); ?>
						</a>
					</div>
				<?php else : ?>
					<p><?php echo esc_html__( 'Your payment could not be processed. Please try again or contact support.', 'fair-payment' ); ?></p>
					<div class="actions">
						<a href="<?php echo esc_url( site_url( '/fair-payment/checkout' ) ); ?>" class="fair-payment-button">
							<?php echo esc_html__( 'Try Again', 'fair-payment' ); ?>
						</a>
						<a href="mailto:support@example.com" class="fair-payment-button secondary">
							<?php echo esc_html__( 'Contact Support', 'fair-payment' ); ?>
						</a>
					</div>
				<?php endif; ?>
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

		<style>
		.fair-payment-status {
			text-align: center;
			margin: 2rem 0;
			padding: 2rem;
			border-radius: 8px;
		}
		.fair-payment-status.success {
			background: #d4f6d4;
			color: #2d5a2d;
			border: 2px solid #4caf50;
		}
		.fair-payment-status.pending {
			background: #fff3cd;
			color: #856404;
			border: 2px solid #ffc107;
		}
		.fair-payment-status.failed {
			background: #f8d7da;
			color: #721c24;
			border: 2px solid #dc3545;
		}
		.status-icon {
			font-size: 3rem;
			margin-bottom: 1rem;
		}
		.status-title {
			font-size: 1.5rem;
			font-weight: bold;
			margin-bottom: 0.5rem;
		}
		.payment-details {
			margin: 2rem 0;
		}
		.details-grid {
			background: #f9f9f9;
			padding: 1.5rem;
			border-radius: 8px;
		}
		.detail-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 0.75rem 0;
			border-bottom: 1px solid #e0e0e0;
		}
		.detail-row:last-child {
			border-bottom: none;
		}
		.detail-row .label {
			font-weight: bold;
			color: #666;
		}
		.detail-row .value {
			font-weight: 500;
		}
		.status-completed {
			color: #4caf50;
			font-weight: bold;
		}
		.status-pending {
			color: #ff9800;
			font-weight: bold;
		}
		.status-failed {
			color: #f44336;
			font-weight: bold;
		}
		.receipt-section, .action-section {
			margin: 2rem 0;
			padding: 1.5rem;
			background: #f9f9f9;
			border-radius: 8px;
		}
		.receipt-actions, .actions {
			display: flex;
			gap: 1rem;
			margin-top: 1rem;
			flex-wrap: wrap;
		}
		.fair-payment-button.secondary {
			background: #6c757d;
			text-decoration: none;
			display: inline-block;
		}
		.fair-payment-button.secondary:hover {
			background: #5a6268;
		}
		.fair-payment-footer {
			text-align: center;
			margin-top: 2rem;
			padding-top: 1rem;
			border-top: 1px solid #ddd;
			color: #666;
		}
		@media (max-width: 600px) {
			.detail-row {
				flex-direction: column;
				align-items: flex-start;
				gap: 0.5rem;
			}
			.receipt-actions, .actions {
				flex-direction: column;
			}
		}
		</style>
		<?php
	}

	/**
	 * Render status message based on payment result
	 *
	 * @param string $status Payment status.
	 * @return void
	 */
	private function render_status_message( $status ) {
		switch ( $status ) {
			case 'completed':
				?>
				<div class="fair-payment-status success">
					<div class="status-icon">✅</div>
					<div class="status-title"><?php echo esc_html__( 'Payment Successful!', 'fair-payment' ); ?></div>
					<p><?php echo esc_html__( 'Thank you for your payment. Your transaction has been completed successfully.', 'fair-payment' ); ?></p>
				</div>
				<?php
				break;

			case 'pending':
				?>
				<div class="fair-payment-status pending">
					<div class="status-icon">⏳</div>
					<div class="status-title"><?php echo esc_html__( 'Payment Pending', 'fair-payment' ); ?></div>
					<p><?php echo esc_html__( 'Your payment is being processed. This may take a few moments.', 'fair-payment' ); ?></p>
				</div>
				<?php
				break;

			default:
				?>
				<div class="fair-payment-status failed">
					<div class="status-icon">❌</div>
					<div class="status-title"><?php echo esc_html__( 'Payment Failed', 'fair-payment' ); ?></div>
					<p><?php echo esc_html__( 'Unfortunately, your payment could not be processed. Please try again.', 'fair-payment' ); ?></p>
				</div>
				<?php
		}
	}

	/**
	 * Get payment status for demonstration
	 *
	 * @return string Payment status.
	 */
	private function get_payment_status() {
		// Simulate different statuses based on payment ID for demo
		if ( ! $this->payment_id ) {
			return 'completed';
		}

		$last_digit = substr( $this->payment_id, -1 );
		if ( in_array( $last_digit, array( '1', '2', '3', '4', '5', '6', '7' ), true ) ) {
			return 'completed';
		} elseif ( in_array( $last_digit, array( '8', '9' ), true ) ) {
			return 'pending';
		} else {
			return 'failed';
		}
	}

	/**
	 * Generate a mock transaction ID
	 *
	 * @return string Transaction ID.
	 */
	private function generate_transaction_id() {
		return 'TXN_' . strtoupper( wp_generate_password( 12, false ) );
	}

	/**
	 * Get receipt download URL
	 *
	 * @return string Download URL.
	 */
	private function get_receipt_download_url() {
		// This would generate an actual PDF in a real implementation
		return '#';
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