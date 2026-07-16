<?php
/**
 * Event Signup Block - Server-side rendering
 *
 * Base (fair-audience inactive) behaviour is the anonymous get-tickets form.
 * When fair-audience is active this delegates to its Event Signup block so the
 * participant-aware flow (identity, pricing, invitations) renders unchanged.
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// When fair-audience is active it owns the participant-aware signup flow.
// Delegate to its block via render_block() so its richer render runs unchanged
// and its view script/styles enqueue, then stop. Nested question blocks are
// forwarded so the delegated render receives them as $content, exactly as on
// the legacy fair-audience block.
if ( class_exists( \FairAudience\API\EventSignupController::class ) ) {
	$delegated_block              = $block->parsed_block;
	$delegated_block['blockName'] = 'fair-audience/event-signup';
	$delegated_block['attrs']     = array(
		'signupButtonText' => $attributes['submitButtonText'] ?? '',
	);
	echo render_block( $delegated_block ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render_block() returns trusted, already-escaped block markup.
	return;
}

$submit_button_text = $attributes['submitButtonText'] ?? __( 'Get Tickets', 'fair-events' );

// Resolve event_date_id: query string (date, scoped to this post's series;
// legacy numeric id kept for old links) → block attribute → current post's
// event date.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$raw_event_date_param = isset( $_GET['event_date'] ) ? sanitize_text_field( wp_unslash( $_GET['event_date'] ) ) : '';
$event_date_id        = 0;

if ( '' !== $raw_event_date_param && class_exists( \FairEvents\Models\EventDates::class ) ) {
	if ( \FairEvents\Helpers\OccurrenceDateParam::is_legacy_id( $raw_event_date_param ) ) {
		$event_date_id = absint( $raw_event_date_param );
	} else {
		$date = \FairEvents\Helpers\OccurrenceDateParam::parse( $raw_event_date_param );
		if ( null !== $date ) {
			// get_by_event_id() only matches rows with their own event_id set
			// (master/single occurrences), so this is always the series master.
			$post_event_date = \FairEvents\Models\EventDates::get_by_event_id( get_the_ID() );
			if ( $post_event_date ) {
				$matched = \FairEvents\Models\EventDates::get_by_master_id_and_date( (int) $post_event_date->id, $date );
				if ( $matched ) {
					$event_date_id = (int) $matched->id;
				}
			}
		}
	}
}

if ( ! $event_date_id ) {
	$event_date_id = (int) ( $attributes['eventDateId'] ?? 0 );
}

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
	echo '<p>' . esc_html__( 'Event Signup: could not resolve an event date for this page.', 'fair-events' ) . '</p>';
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

// Pivot config/pricing lookups to the series master for generated occurrences.
// The form still links the signup to the specific occurrence via $event_date_id.
$pricing_event_date_id = $event_date_id;
if ( $event_date
	&& 'generated' === ( $event_date->occurrence_type ?? null )
	&& ! empty( $event_date->master_id )
) {
	$pricing_event_date_id = (int) $event_date->master_id;
}

// Load ticket types.
$ticket_types = array();
if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
	$ticket_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( $pricing_event_date_id );
}

// Resolve the series master (if any) so 'multiple_instances' ticket types can
// offer a checkbox picker across the recurring series' upcoming occurrences.
$series_master_id = null;
if ( $event_date && class_exists( \FairEvents\Models\EventDates::class ) ) {
	if ( 'master' === ( $event_date->occurrence_type ?? null ) ) {
		$series_master_id = (int) $event_date->id;
	} elseif ( 'generated' === ( $event_date->occurrence_type ?? null ) && ! empty( $event_date->master_id ) ) {
		$series_master_id = (int) $event_date->master_id;
	}
}

$has_multiple_instances_type = false;
foreach ( $ticket_types as $ticket_type ) {
	if ( $ticket_type->is_multiple_instances() ) {
		$has_multiple_instances_type = true;
		break;
	}
}

$occurrences_for_picker = array();
if ( $has_multiple_instances_type && $series_master_id && class_exists( \FairEvents\Models\EventDates::class ) ) {
	$upcoming = \FairEvents\Models\EventDates::get_upcoming_by_master_id( $series_master_id );
	foreach ( $upcoming as $occ ) {
		$occurrences_for_picker[] = array(
			'id'             => (int) $occ->id,
			'start_datetime' => $occ->start_datetime,
			'end_datetime'   => $occ->end_datetime,
			'all_day'        => (bool) $occ->all_day,
		);
	}
}
$has_instance_picker = ! empty( $occurrences_for_picker );

// Find active sale period and load prices.
$price_by_type_id   = array();
$active_sale_period = null;
if ( class_exists( \FairEvents\Models\TicketSalePeriod::class ) && class_exists( \FairEvents\Models\TicketPrice::class ) ) {
	$sale_periods = \FairEvents\Models\TicketSalePeriod::get_all_by_event_date_id( $pricing_event_date_id );
	$now          = current_time( 'mysql' );
	foreach ( $sale_periods as $period ) {
		if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
			$active_sale_period = $period;
			$prices             = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $pricing_event_date_id );
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

/**
 * Extension point for plugins (e.g. fair-audience) that want to enrich the
 * base signup form without owning a competing render — resolved viewer
 * identity, session pre-fill, or group/participant-filtered ticket types and
 * prices can all be layered on by filtering this context array. See
 * REST_API_BACKEND.md for the documented shape and consumers.
 *
 * @param array    $context    Render context (event_date_id, ticket_types, price_by_type_id,
 *                              active_sale_period, occurrences_for_picker, currency_symbol,
 *                              callback_status, callback_tx_id, callback_token, prefill_name,
 *                              prefill_email, submit_button_text).
 * @param array    $attributes Block attributes.
 * @param WP_Block $block      Block instance.
 */
$context = apply_filters(
	'fair_events_signup_render_context',
	array(
		'event_date_id'          => $event_date_id,
		'ticket_types'           => $ticket_types,
		'price_by_type_id'       => $price_by_type_id,
		'active_sale_period'     => $active_sale_period,
		'occurrences_for_picker' => $occurrences_for_picker,
		'currency_symbol'        => $currency_symbol,
		'callback_status'        => $callback_status,
		'callback_tx_id'         => $callback_tx_id,
		'callback_token'         => $callback_token,
		'prefill_name'           => '',
		'prefill_email'          => '',
		'submit_button_text'     => $submit_button_text,
	),
	$attributes,
	$block
);

$event_date_id          = (int) $context['event_date_id'];
$ticket_types           = $context['ticket_types'];
$price_by_type_id       = $context['price_by_type_id'];
$active_sale_period     = $context['active_sale_period'];
$occurrences_for_picker = $context['occurrences_for_picker'];
$has_instance_picker    = ! empty( $occurrences_for_picker );
$currency_symbol        = $context['currency_symbol'];
$callback_status        = $context['callback_status'];
$prefill_name           = $context['prefill_name'];
$prefill_email          = $context['prefill_email'];
$submit_button_text     = $context['submit_button_text'];

// Recompute the multiple_instances flag from the (possibly filtered) ticket types.
$has_multiple_instances_type = false;
foreach ( $ticket_types as $ticket_type ) {
	if ( $ticket_type->is_multiple_instances() ) {
		$has_multiple_instances_type = true;
		break;
	}
}

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
		data-fair-audience-active="<?php echo esc_attr( class_exists( \FairAudience\API\EventSignupController::class ) ? '1' : '0' ); ?>"
	>
		<?php
		/**
		 * Fires just inside the signup <form>, before the name/email fields.
		 * fair-audience uses this to contribute identity fragments (resume
		 * card, register-with-token prompt) without a parallel template.
		 *
		 * @param array $context Render context, see fair_events_signup_render_context.
		 */
		do_action( 'fair_events_signup_render_before_form', $context );
		?>

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
				value="<?php echo esc_attr( $prefill_name ); ?>"
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
				value="<?php echo esc_attr( $prefill_email ); ?>"
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
						<option
							value="<?php echo esc_attr( $type_id ); ?>"
							data-ticket-price="<?php echo esc_attr( null !== $type_price ? number_format( $type_price, 2, '.', '' ) : '' ); ?>"
							data-recurrence-scope="<?php echo esc_attr( $ticket_type->recurrence_scope ); ?>"
							data-min-instances="<?php echo esc_attr( (string) $ticket_type->minimum_instances ); ?>"
						>
							<?php echo esc_html( $label ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
		<?php endif; ?>

		<?php if ( $has_instance_picker ) : ?>
			<div class="form-row fair-events-instance-picker" style="display: none;">
				<span class="form-label"><?php esc_html_e( 'Choose occurrences', 'fair-events' ); ?></span>
				<?php foreach ( $occurrences_for_picker as $occ_row ) : ?>
					<?php
					$occ_label   = \FairEvents\Helpers\DateRangeFormatter::format(
						$occ_row['start_datetime'],
						$occ_row['end_datetime'],
						$occ_row['all_day']
					);
					$checkbox_id = $form_id . '-inst-' . (int) $occ_row['id'];
					?>
					<label class="fair-events-instance-option" for="<?php echo esc_attr( $checkbox_id ); ?>">
						<input
							type="checkbox"
							name="event_date_ids[]"
							id="<?php echo esc_attr( $checkbox_id ); ?>"
							value="<?php echo (int) $occ_row['id']; ?>"
							class="form-checkbox"
						/>
						<?php echo esc_html( $occ_label ); ?>
					</label>
				<?php endforeach; ?>
				<p class="fair-events-instance-picker-hint"></p>
				<p class="fair-events-instance-picker-total"></p>
			</div>
		<?php endif; ?>

		<div class="form-row fair-events-quantity-row">
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

		<?php
		/**
		 * Fires just inside the signup <form>, after the submit button.
		 * fair-audience uses this to contribute identity fragments
		 * (request-link prompt, retry-payment card) without a parallel
		 * template.
		 *
		 * @param array $context Render context, see fair_events_signup_render_context.
		 */
		do_action( 'fair_events_signup_render_after_form', $context );
		?>
	</form>

	<div class="message-container" role="alert" aria-live="polite"></div>

	<?php if ( $powered_by ) : ?>
		<p class="fair-events-powered-by">
			<?php esc_html_e( 'Powered by Fair Events', 'fair-events' ); ?>
		</p>
	<?php endif; ?>
<?php endif; ?>
</div>
