<?php
/**
 * Server-side rendering for My Fees block
 *
 * @package FairMembership
 */

defined( 'WPINC' ) || die;

use FairMembership\Models\UserFee;

// Check if user is logged in
$is_logged_in = is_user_logged_in();
$user_id      = get_current_user_id();

// Check if fair-payment plugin is available
$fair_payment_available = function_exists( 'fair_payment_create_transaction' ) && function_exists( 'fair_payment_initiate_payment' );

// Handle payment action if form was submitted
if ( $is_logged_in && $fair_payment_available && isset( $_POST['pay_fee_id'] ) && isset( $_POST['pay_fee_nonce'] ) ) {
	if ( wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['pay_fee_nonce'] ) ), 'pay_fee_action' ) ) {
		$fee_id = absint( $_POST['pay_fee_id'] );

		// Get the fee and verify it belongs to current user
		$user_fee = UserFee::get_by_id( $fee_id );

		if ( $user_fee && $user_fee->user_id === $user_id && in_array( $user_fee->status, array( 'pending', 'overdue' ), true ) ) {
			// Create transaction
			$transaction_id = fair_payment_create_transaction(
				array(
					array(
						'name'     => $user_fee->title,
						'quantity' => 1,
						'amount'   => $user_fee->amount,
					),
				),
				array(
					'currency'    => 'EUR',
					'description' => sprintf(
						/* translators: %s: fee title */
						__( 'Payment for: %s', 'fair-membership' ),
						$user_fee->title
					),
					'user_id'     => $user_fee->user_id,
					'metadata'    => array(
						'user_fee_id' => $user_fee->id,
						'plugin'      => 'fair-membership',
					),
				)
			);

			if ( ! is_wp_error( $transaction_id ) ) {
				// Initiate payment
				$payment = fair_payment_initiate_payment(
					$transaction_id,
					array(
						'redirect_url' => get_permalink(),
					)
				);

				if ( ! is_wp_error( $payment ) && isset( $payment['checkout_url'] ) ) {
					wp_safe_redirect( $payment['checkout_url'] );
					exit;
				}
			}
		}
	}
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'fair-membership-my-fees',
	)
);

?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( ! $is_logged_in ) : ?>
		<div class="my-fees-login-prompt">
			<p><?php esc_html_e( 'Please log in to view your membership fees.', 'fair-membership' ); ?></p>
			<a href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>" class="button">
				<?php esc_html_e( 'Log In', 'fair-membership' ); ?>
			</a>
		</div>
	<?php else : ?>
		<?php
		// Get user's fees
		$user_fees = UserFee::get_all( array( 'user_id' => $user_id ) );

		if ( empty( $user_fees ) ) :
			?>
			<div class="my-fees-empty">
				<p><?php esc_html_e( 'You have no fees at this time.', 'fair-membership' ); ?></p>
			</div>
		<?php else : ?>
			<div class="my-fees-container">
				<table class="my-fees-table">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Title', 'fair-membership' ); ?></th>
							<th><?php esc_html_e( 'Amount', 'fair-membership' ); ?></th>
							<th><?php esc_html_e( 'Due Date', 'fair-membership' ); ?></th>
							<th><?php esc_html_e( 'Status', 'fair-membership' ); ?></th>
							<th><?php esc_html_e( 'Actions', 'fair-membership' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $user_fees as $user_fee ) : ?>
							<?php
							// Calculate effective status (check if overdue)
							$effective_status = $user_fee->status;
							if ( 'pending' === $user_fee->status && strtotime( $user_fee->due_date ) < time() ) {
								$effective_status = 'overdue';
							}

							// Translate status
							$status_labels = array(
								'pending'   => __( 'Pending', 'fair-membership' ),
								'paid'      => __( 'Paid', 'fair-membership' ),
								'overdue'   => __( 'Overdue', 'fair-membership' ),
								'cancelled' => __( 'Cancelled', 'fair-membership' ),
							);
							$status_label  = $status_labels[ $effective_status ] ?? $effective_status;

							// Show payment button for unpaid fees (if fair-payment is available)
							$show_payment_button = $fair_payment_available && in_array( $effective_status, array( 'pending', 'overdue' ), true );
							?>
							<tr>
								<td data-label="<?php esc_attr_e( 'Title', 'fair-membership' ); ?>">
									<strong><?php echo esc_html( $user_fee->title ); ?></strong>
									<?php if ( $user_fee->notes ) : ?>
										<div class="fee-notes">
											<?php echo esc_html( $user_fee->notes ); ?>
										</div>
									<?php endif; ?>
								</td>
								<td data-label="<?php esc_attr_e( 'Amount', 'fair-membership' ); ?>">
									<?php echo esc_html( '€' . number_format( $user_fee->amount, 2, '.', ',' ) ); ?>
								</td>
								<td data-label="<?php esc_attr_e( 'Due Date', 'fair-membership' ); ?>">
									<?php echo esc_html( gmdate( 'Y-m-d', strtotime( $user_fee->due_date ) ) ); ?>
								</td>
								<td data-label="<?php esc_attr_e( 'Status', 'fair-membership' ); ?>">
									<span class="fee-status-badge fee-status-<?php echo esc_attr( $effective_status ); ?>">
										<?php echo esc_html( $status_label ); ?>
									</span>
									<?php if ( 'paid' === $user_fee->status && $user_fee->paid_at ) : ?>
										<div class="fee-paid-date">
											<?php
											echo esc_html(
												sprintf(
													/* translators: %s: paid date */
													__( 'Paid: %s', 'fair-membership' ),
													gmdate( 'Y-m-d', strtotime( $user_fee->paid_at ) )
												)
											);
											?>
										</div>
									<?php endif; ?>
								</td>
								<td data-label="<?php esc_attr_e( 'Actions', 'fair-membership' ); ?>">
									<?php if ( $show_payment_button ) : ?>
										<form method="post" style="display:inline;">
											<?php wp_nonce_field( 'pay_fee_action', 'pay_fee_nonce' ); ?>
											<input type="hidden" name="pay_fee_id" value="<?php echo esc_attr( $user_fee->id ); ?>">
											<button type="submit" class="button button-primary">
												<?php esc_html_e( 'Pay Now', 'fair-membership' ); ?>
											</button>
										</form>
									<?php else : ?>
										<span class="no-action">—</span>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			</div>
		<?php endif; ?>
	<?php endif; ?>
</div>
