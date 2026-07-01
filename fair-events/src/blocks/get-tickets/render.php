<?php
/**
 * Get Tickets Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// If fair-audience is active, defer to its Event Signup block.
if ( class_exists( \FairAudience\API\EventSignupController::class ) ) {
	echo '<div class="fair-events-get-tickets-notice">';
	echo '<p>' . esc_html__( 'fair-audience is active. Use the Event Signup block instead.', 'fair-events' ) . '</p>';
	echo '</div>';
	return;
}

$submit_button_text = $attributes['submitButtonText'] ?? __( 'Get Tickets', 'fair-events' );

// Resolve event_date_id: query string → block attribute → current post's event date.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$event_date_id = isset( $_GET['event_date'] ) ? absint( $_GET['event_date'] ) : (int) ( $attributes['eventDateId'] ?? 0 );

if ( ! $event_date_id && class_exists( \FairEvents\Models\EventDates::class ) ) {
	$post_event_date = \FairEvents\Models\EventDates::get_by_event_id( get_the_ID() );
	if ( $post_event_date ) {
		$event_date_id = (int) $post_event_date->id;
	}
}

if ( ! $event_date_id ) {
	// Only shown in the editor / when the block is placed on a non-event page
	// with no event_date context at all.
	echo '<div class="fair-events-get-tickets-placeholder">';
	echo '<p>' . esc_html__( 'Get Tickets: could not resolve an event date for this page.', 'fair-events' ) . '</p>';
	echo '</div>';
	return;
}

// Handle fair_payment_callback return state.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$is_payment_callback = ! empty( $_GET['fair_payment_callback'] ) && ! empty( $_GET['transaction_id'] );
$callback_status     = '';
$callback_tx_id      = 0;
$callback_token      = '';
if ( $is_payment_callback && class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_tx_id = absint( $_GET['transaction_id'] );
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';
	$transaction    = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $callback_tx_id );
	$expected_token = $transaction ? (string) ( $transaction->access_token ?? '' ) : '';
	if ( $transaction && '' !== $expected_token && '' !== $callback_token && hash_equals( $expected_token, $callback_token ) ) {
		$callback_status = \FairPaymentsConnector\Payment\PaymentStatus::from_raw_status( (string) $transaction->status );
	}
}

// Load event date.
$event_date = null;
if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
	$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
}

// Load ticket types.
$ticket_types = array();
if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
	$ticket_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( $event_date_id );
}

// Find active sale period and load prices.
$price_by_type_id   = array();
$active_sale_period = null;
if ( class_exists( \FairEvents\Models\TicketSalePeriod::class ) && class_exists( \FairEvents\Models\TicketPrice::class ) ) {
	$sale_periods = \FairEvents\Models\TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
	$now          = current_time( 'mysql' );
	foreach ( $sale_periods as $period ) {
		if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
			$active_sale_period = $period;
			$prices             = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $event_date_id );
			foreach ( $prices as $price ) {
				if ( (int) $price->sale_period_id === (int) $period->id ) {
					$price_by_type_id[ (int) $price->ticket_type_id ] = (float) $price->price;
				}
			}
			break;
		}
	}
}

$currency_symbol = 'EUR' === get_option( 'fair_payment_currency', 'EUR' ) ? '€' : get_option( 'fair_payment_currency', 'EUR' );
$powered_by      = (bool) get_option( 'fair_events_powered_by_branding', false );

// Generate unique form ID.
$form_id = 'fair-events-get-tickets-' . wp_unique_id();
?>

<div class="fair-events-get-tickets">
<?php if ( 'confirmed' === $callback_status ) : ?>
	<div class="message-container message-success" role="alert">
		<?php esc_html_e( 'Your ticket purchase was successful! Thank you.', 'fair-events' ); ?>
	</div>
<?php elseif ( 'failed' === $callback_status ) : ?>
	<div class="message-container message-error" role="alert">
		<?php esc_html_e( 'Your payment was not completed. Please try again.', 'fair-events' ); ?>
	</div>
<?php elseif ( 'processing' === $callback_status ) : ?>
	<div class="message-container message-processing" role="alert">
		<?php esc_html_e( 'Your payment is being processed. Please check back shortly.', 'fair-events' ); ?>
	</div>
<?php endif; ?>

<?php if ( 'confirmed' !== $callback_status ) : ?>
	<form
		id="<?php echo esc_attr( $form_id ); ?>"
		class="fair-events-get-tickets-form"
		data-event-date-id="<?php echo esc_attr( $event_date_id ); ?>"
	>
		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-name" class="form-label">
				<?php esc_html_e( 'Your Name', 'fair-events' ); ?>
				<span class="required-indicator" aria-hidden="true">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="name"
				class="form-input"
				required
				maxlength="255"
				autocomplete="name"
			/>
		</div>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-email" class="form-label">
				<?php esc_html_e( 'Your Email', 'fair-events' ); ?>
				<span class="required-indicator" aria-hidden="true">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="email"
				class="form-input"
				required
				autocomplete="email"
			/>
		</div>

		<?php if ( ! empty( $ticket_types ) ) : ?>
			<div class="form-row">
				<label for="<?php echo esc_attr( $form_id ); ?>-ticket-type" class="form-label">
					<?php esc_html_e( 'Ticket Type', 'fair-events' ); ?>
				</label>
				<select
					id="<?php echo esc_attr( $form_id ); ?>-ticket-type"
					name="ticket_type_id"
					class="form-input"
				>
					<option value=""><?php esc_html_e( 'Select a ticket type…', 'fair-events' ); ?></option>
					<?php foreach ( $ticket_types as $ticket_type ) : ?>
						<?php
						$type_id    = (int) $ticket_type->id;
						$type_price = $price_by_type_id[ $type_id ] ?? null;
						$label      = esc_html( $ticket_type->name );
						if ( null !== $type_price ) {
							$label .= ' — ' . esc_html( $currency_symbol . number_format( $type_price, 2 ) );
						} elseif ( null === $active_sale_period ) {
							$label .= ' — ' . esc_html__( 'No active sale period', 'fair-events' );
						}
						?>
						<option value="<?php echo esc_attr( $type_id ); ?>">
							<?php echo esc_html( $label ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
		<?php endif; ?>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-quantity" class="form-label">
				<?php esc_html_e( 'Quantity', 'fair-events' ); ?>
			</label>
			<input
				type="number"
				id="<?php echo esc_attr( $form_id ); ?>-quantity"
				name="quantity"
				class="form-input"
				value="1"
				min="1"
				max="10"
			/>
		</div>

		<div class="form-row">
			<label class="form-checkbox-label">
				<input
					type="checkbox"
					name="mailing_opt_in"
					value="1"
					class="form-checkbox"
				/>
				<?php esc_html_e( 'Keep me informed about future events', 'fair-events' ); ?>
			</label>
		</div>

		<!-- Honeypot field (hidden from users, should remain empty) -->
		<input
			type="text"
			name="_honeypot"
			class="honeypot-field"
			tabindex="-1"
			autocomplete="off"
			aria-hidden="true"
		/>

		<div class="form-row form-submit">
			<button type="submit" class="form-button wp-block-button__link wp-element-button">
				<?php echo esc_html( $submit_button_text ); ?>
			</button>
		</div>
	</form>

	<div class="message-container" role="alert" aria-live="polite"></div>

	<?php if ( $powered_by ) : ?>
		<p class="fair-events-powered-by">
			<?php esc_html_e( 'Powered by Fair Events', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
<?php endif; ?>
</div>
