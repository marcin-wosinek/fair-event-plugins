<?php
/**
 * Event Signup Block - Server-side rendering
 *
 * Renders the anonymous get-tickets form. When fair-audience is active it
 * enriches this same render via the fair_events_signup_render_context filter
 * and the render slots (identity, pricing, cancel/resignup) instead of owning
 * a competing template.
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

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

// Handle fair_payment_callback return state, plus a direct-navigation
// fallback: a visitor who navigates straight back to the event page (no
// provider redirect) is recognised via the short-lived SignupPaymentSession
// cookie set when create_signup() returned payment_required, so the same
// confirmed/processing/resume/retry card shows within the payment hold
// window. See SignupPaymentState for the state resolution this feeds.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$is_payment_callback = ! empty( $_GET['fair_payment_callback'] ) && ! empty( $_GET['transaction_id'] );
$callback_tx_id      = 0;
$callback_token      = '';
$signup_transaction  = null;
$signup_state        = null;

if ( $is_payment_callback && class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_tx_id = absint( $_GET['transaction_id'] );
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';
	$transaction    = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $callback_tx_id );
	$expected_token = $transaction ? (string) ( $transaction->access_token ?? '' ) : '';
	if ( $transaction && '' !== $expected_token && '' !== $callback_token && hash_equals( $expected_token, $callback_token ) ) {
		$signup_transaction = $transaction;
	}
}

if ( ! $signup_transaction
	&& class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
	&& class_exists( \FairEvents\Services\SignupPaymentSession::class )
) {
	$session = \FairEvents\Services\SignupPaymentSession::get();
	if ( $session ) {
		$session_signup = \FairEvents\Models\EventSignup::get_by_id( $session['signup_id'] );
		if ( $session_signup
			&& (int) $session_signup->transaction_id === $session['transaction_id']
			&& 'pending_payment' === $session_signup->status
			&& $session_signup->payment_expires_at
			&& strtotime( $session_signup->payment_expires_at ) > time()
		) {
			$signup_transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $session['transaction_id'] );
			if ( $signup_transaction ) {
				$callback_tx_id = (int) $session['transaction_id'];
				$callback_token = (string) ( $signup_transaction->access_token ?? '' );
			}
		}
	}
}

if ( $signup_transaction && class_exists( \FairEvents\Services\SignupPaymentState::class ) ) {
	$signup_rows  = \FairEvents\Models\EventSignup::get_all_by_transaction_id( (int) $signup_transaction->id );
	$signup_state = \FairEvents\Services\SignupPaymentState::resolve_for_transaction( $signup_transaction, $signup_rows );
}

// Legacy three-value key, kept for back-compat with fair_events_signup_render_context
// consumers documented in REST_API_BACKEND.md; 'resume'/'retry' both map to
// 'failed' here since that enum predates the richer state.
$callback_status = '';
if ( $signup_state ) {
	$callback_status = in_array( $signup_state['state'], array( 'resume', 'retry' ), true )
		? 'failed'
		: $signup_state['state'];
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

// Loaded whenever the event is part of a recurring series, independent of
// which ticket scopes are configured — the single-occurrence dropdown (below)
// needs the same upcoming-occurrences list as the multi-occurrence checkbox
// picker, even on a series with only a 'single_instance' ticket type.
$occurrences_for_picker = array();
if ( $series_master_id && class_exists( \FairEvents\Models\EventDates::class ) ) {
	$upcoming = \FairEvents\Models\EventDates::get_upcoming_by_master_id( $series_master_id );
	foreach ( $upcoming as $occ ) {
		$occurrences_for_picker[] = array(
			'id'             => (int) $occ->id,
			'start_datetime' => $occ->start_datetime,
			'end_datetime'   => $occ->end_datetime,
			'all_day'        => (bool) $occ->all_day,
			// A companion plugin (fair-audience) flips this true for
			// occurrences the recognised viewer already holds, so the
			// pickers below can label/disable them instead of allowing a
			// silent double-book.
			'signed_up'      => false,
		);
	}
}
$has_instance_picker = $has_multiple_instances_type && ! empty( $occurrences_for_picker );

// Find active sale period and load prices. Delegates to the shared
// TicketPricing service — the same authority the get-tickets purchase flow
// uses — so the lazy default window and last-period fallback apply here too
// instead of a second, divergent evaluation.
$price_by_type_id   = array();
$active_sale_period = null;
if ( class_exists( \FairEvents\Services\TicketPricing::class ) && class_exists( \FairEvents\Models\TicketPrice::class ) ) {
	$active_sale_period = \FairEvents\Services\TicketPricing::resolve_active_sale_period( $pricing_event_date_id );
	if ( $active_sale_period ) {
		$prices = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $pricing_event_date_id );
		foreach ( $prices as $price ) {
			if ( (int) $price->sale_period_id === (int) $active_sale_period->id ) {
				$price_by_type_id[ (int) $price->ticket_type_id ] = (float) $price->price;
			}
		}
	}
}

// Resolve activity options (ticket options) for this event date, if the
// experimental catalogue is active. Options are displayed as checkboxes —
// participants can select zero or more at signup. Gated on fair-audience
// being active too: selections can only be persisted through its options
// junction table, so a base-alone site must not render dead checkboxes.
$ticket_options = array();
if ( class_exists( \FairAudience\API\EventSignupController::class )
	&& class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
	$raw_options = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $pricing_event_date_id );
	foreach ( $raw_options as $opt ) {
		$resolved_base = class_exists( \FairEventsExperimental\Services\ActivityOptionPriceResolver::class )
			? \FairEventsExperimental\Services\ActivityOptionPriceResolver::resolve( $opt )
			: (float) $opt->price;
		if ( null === $resolved_base ) {
			// Derived mode with no active period / no row → option not purchasable; skip.
			continue;
		}
		$ticket_options[] = array(
			'id'         => (int) $opt->id,
			'name'       => $opt->name,
			'short_name' => $opt->short_name ?? null,
			'price'      => (float) $resolved_base,
			'is_full'    => false,
		);
	}
}

// Minimum number of activities the participant must select. Capped at the
// number of options actually available so the requirement is never
// impossible to satisfy, and only meaningful when at least one option exists.
$minimum_activities = 0;
if ( ! empty( $ticket_options ) && class_exists( \FairEvents\Models\EventDateSetting::class ) ) {
	$minimum_activities = (int) \FairEvents\Models\EventDateSetting::get( $pricing_event_date_id, 'minimum_activities' );
	$minimum_activities = max( 0, min( $minimum_activities, count( $ticket_options ) ) );
}

/**
 * Extension point for plugins (e.g. fair-audience) that want to enrich the
 * base signup form without owning a competing render — resolved viewer
 * identity, session pre-fill, or group/participant-filtered ticket types and
 * prices can all be layered on by filtering this context array. See
 * REST_API_BACKEND.md for the documented shape and consumers.
 *
 * @param array    $context    Render context (event_date_id, pricing_event_date_id, ticket_types,
 *                              price_by_type_id, active_sale_period, occurrences_for_picker,
 *                              ticket_options, minimum_activities,
 *                              callback_status, callback_tx_id, callback_token, callback_state,
 *                              callback_source, prefill_name, prefill_email, submit_button_text,
 *                              suppress_form).
 * @param array    $attributes Block attributes.
 * @param WP_Block $block      Block instance.
 */
$context = apply_filters(
	'fair_events_signup_render_context',
	array(
		'event_date_id'          => $event_date_id,
		// The series-master pivot config/pricing lookups already resolved to,
		// so a companion plugin doesn't need to re-derive it.
		'pricing_event_date_id'  => $pricing_event_date_id,
		'ticket_types'           => $ticket_types,
		'price_by_type_id'       => $price_by_type_id,
		'active_sale_period'     => $active_sale_period,
		'occurrences_for_picker' => $occurrences_for_picker,
		// Activity add-ons and their minimum-selection requirement. A companion
		// plugin (fair-audience) overrides 'price'/'is_full' with participant-
		// aware resolution and adds 'addable_options'/'current_activity_names'
		// for a recognised, already-signed-up viewer.
		'ticket_options'         => $ticket_options,
		'minimum_activities'     => $minimum_activities,
		'callback_status'        => $callback_status,
		'callback_tx_id'         => $callback_tx_id,
		'callback_token'         => $callback_token,
		// Resolved confirmed/processing/resume/retry state + card payload
		// (SignupPaymentState::resolve_for_transaction()'s shape), or null
		// when there's nothing to show. A companion plugin (fair-audience,
		// at the #1245 cutover) overrides this to plug in its own identity
		// lookup instead of the anonymous cookie fallback.
		'callback_state'         => $signup_state,
		// Which lookup produced callback_state: 'url' (provider redirect),
		// 'session' (direct-navigation cookie), or '' when none applied.
		'callback_source'        => $signup_state ? ( $is_payment_callback ? 'url' : 'session' ) : '',
		'prefill_name'           => '',
		'prefill_email'          => '',
		'submit_button_text'     => $submit_button_text,
		// When a companion plugin sets this true (e.g. a recognised viewer
		// who already holds a signup), the base skips the <form> entirely and
		// emits a plain wrapper div instead, still firing the render slots
		// inside it so the companion can render its own signed-up/cancel UI.
		'suppress_form'          => false,
	),
	$attributes,
	$block
);

$event_date_id          = (int) $context['event_date_id'];
$ticket_types           = $context['ticket_types'];
$price_by_type_id       = $context['price_by_type_id'];
$active_sale_period     = $context['active_sale_period'];
$occurrences_for_picker = $context['occurrences_for_picker'];
$ticket_options         = $context['ticket_options'];
$minimum_activities     = $context['minimum_activities'];
$callback_status        = $context['callback_status'];
$signup_state           = $context['callback_state'];
$prefill_name           = $context['prefill_name'];
$prefill_email          = $context['prefill_email'];
$submit_button_text     = $context['submit_button_text'];
$suppress_form          = ! empty( $context['suppress_form'] );

// Recompute the multiple_instances flag from the (possibly filtered) ticket types.
$has_multiple_instances_type = false;
foreach ( $ticket_types as $ticket_type ) {
	if ( $ticket_type->is_multiple_instances() ) {
		$has_multiple_instances_type = true;
		break;
	}
}
$has_instance_picker = $has_multiple_instances_type && ! empty( $occurrences_for_picker );

// A ticket type can raise the minimum-activities requirement above the
// event-date global. Determine whether any selectable type carries a higher
// requirement, and the effective minimum for the type that's pre-selected on
// first paint (the first not-payment-blocked type, mirroring the radio
// pre-selection below). frontend.js recomputes this live as the buyer
// switches ticket type.
$any_ticket_type_min = 0;
if ( ! empty( $ticket_options ) ) {
	foreach ( $ticket_types as $tt_for_min ) {
		$any_ticket_type_min = max( $any_ticket_type_min, (int) $tt_for_min->minimum_activities );
	}
}

// Single-occurrence dropdown: offered whenever the series has more than one
// upcoming occurrence, regardless of which ticket scopes are configured.
// frontend.js shows/hides it based on the selected ticket type's scope.
$has_occurrence_dropdown  = count( $occurrences_for_picker ) > 1;
$default_occurrence_index = 0;
if ( $has_occurrence_dropdown ) {
	foreach ( $occurrences_for_picker as $occ_index => $occ_row ) {
		if ( (int) $occ_row['id'] === $event_date_id ) {
			$default_occurrence_index = $occ_index;
			break;
		}
	}
}

// Fail closed on the visitor form too: when online payments can't be
// collected (connector missing, or installed but unconfigured), a ticket type
// priced above 0 is not purchasable — the endpoint would reject it. Disable
// those options so a priced ticket is never presented as buyable; when every
// configured type is paid, hide the form and show a single message instead of
// a list of dead options (per the ticket's open-question recommendation).
$payments_unavailable = ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
	|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured();

$has_paid_type = false;
$has_free_type = false;
foreach ( $ticket_types as $ticket_type ) {
	$tt_price = $price_by_type_id[ (int) $ticket_type->id ] ?? null;
	if ( null !== $tt_price && $tt_price > 0 ) {
		$has_paid_type = true;
	} else {
		$has_free_type = true;
	}
}
// Nothing is purchasable when payments are down and every configured ticket
// type carries a price. Registering with no ticket type, or a free type, still
// works — so the form is only hidden when a free path doesn't exist.
$all_purchases_blocked = $payments_unavailable
	&& ! empty( $ticket_types )
	&& $has_paid_type
	&& ! $has_free_type;

// Generate unique form ID.
$form_id = 'fair-events-get-tickets-' . wp_unique_id();

// The editor's live preview nests this render inside its own block wrapper
// (editor.js's useBlockProps() div), which already carries the
// wp-block-fair-events-event-signup class and any spacing support styles. Adding
// get_block_wrapper_attributes() here too would duplicate both — a second
// element matching the block's wrapper class, and doubled-up padding/margin.
if ( ! empty( $attributes['isEditorPreview'] ) ) {
	$wrapper_attributes = sprintf(
		'class="fair-events-get-tickets" data-currency="%s"',
		esc_attr( \FairEventsShared\Money::site_currency() )
	);
} else {
	$wrapper_attributes = get_block_wrapper_attributes(
		array(
			'class'         => 'fair-events-get-tickets',
			'data-currency' => \FairEventsShared\Money::site_currency(),
		)
	);
}
?>

<div <?php echo wp_kses_post( $wrapper_attributes ); ?>>
<?php if ( $signup_state ) : ?>
	<?php
	$amount_display = \FairEventsShared\Money::format_display( (float) $signup_state['amount'], $signup_state['currency'] );
	?>
	<?php if ( 'confirmed' === $signup_state['state'] ) : ?>
		<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-confirmed" data-transaction-id="<?php echo esc_attr( (string) $signup_state['transaction_id'] ); ?>">
			<div class="fair-events-get-tickets-callback-icon" aria-hidden="true">✓</div>
			<h2 class="fair-events-get-tickets-callback-heading"><?php esc_html_e( 'Payment confirmed', 'fair-events' ); ?></h2>
			<?php if ( $signup_state['event_title'] ) : ?>
				<p class="fair-events-get-tickets-callback-event">
					<?php
					printf(
						/* translators: %s: event title */
						esc_html__( "You're signed up for %s.", 'fair-events' ),
						'<strong>' . esc_html( $signup_state['event_title'] ) . '</strong>'
					);
					?>
				</p>
			<?php endif; ?>
			<p class="fair-events-get-tickets-callback-amount">
				<?php
				printf(
					/* translators: %s: formatted amount with currency */
					esc_html__( 'Amount paid: %s', 'fair-events' ),
					esc_html( $amount_display )
				);
				?>
			</p>
			<p class="fair-events-get-tickets-callback-email">
				<?php esc_html_e( 'A confirmation email is on its way. You can close this page.', 'fair-events' ); ?>
			</p>
		</div>
	<?php elseif ( 'processing' === $signup_state['state'] ) : ?>
		<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-processing"
			data-transaction-id="<?php echo esc_attr( (string) $signup_state['transaction_id'] ); ?>"
			data-token="<?php echo esc_attr( $callback_token ); ?>">
			<div class="fair-events-get-tickets-callback-spinner" aria-hidden="true"></div>
			<h2 class="fair-events-get-tickets-callback-heading"><?php esc_html_e( 'Thank you for your payment!', 'fair-events' ); ?></h2>
			<p class="fair-events-get-tickets-callback-status">
				<?php esc_html_e( "We're confirming with your bank. This usually takes a few seconds — the page will update as soon as it's done.", 'fair-events' ); ?>
			</p>
			<p class="fair-events-get-tickets-callback-amount">
				<?php
				printf(
					/* translators: %s: formatted amount with currency */
					esc_html__( 'Amount: %s', 'fair-events' ),
					esc_html( $amount_display )
				);
				?>
			</p>
		</div>
	<?php elseif ( 'resume' === $signup_state['state'] ) : ?>
		<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-resume"
			data-transaction-id="<?php echo esc_attr( (string) $signup_state['transaction_id'] ); ?>"
			data-token="<?php echo esc_attr( $callback_token ); ?>">
			<p class="fair-events-get-tickets-callback-heading"><strong><?php esc_html_e( 'Your payment is waiting.', 'fair-events' ); ?></strong></p>
			<p class="fair-events-get-tickets-callback-status">
				<?php esc_html_e( 'You can pick up where you left off on the secure payment page.', 'fair-events' ); ?>
			</p>
			<p class="fair-events-get-tickets-callback-amount">
				<?php
				printf(
					/* translators: %s: formatted amount with currency */
					esc_html__( 'Amount due: %s', 'fair-events' ),
					esc_html( $amount_display )
				);
				?>
			</p>
			<div class="wp-block-button">
				<a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( $signup_state['checkout_url'] ); ?>">
					<?php esc_html_e( 'Continue payment', 'fair-events' ); ?>
				</a>
			</div>
			<p class="fair-events-get-tickets-callback-cancel">
				<a href="#" class="fair-events-get-tickets-callback-cancel-link"><?php esc_html_e( 'Cancel and start over', 'fair-events' ); ?></a>
			</p>
		</div>
	<?php elseif ( 'retry' === $signup_state['state'] ) : ?>
		<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-retry"
			data-transaction-id="<?php echo esc_attr( (string) $signup_state['transaction_id'] ); ?>"
			data-token="<?php echo esc_attr( $callback_token ); ?>">
			<p class="fair-events-get-tickets-callback-heading"><strong><?php esc_html_e( "Your payment didn't go through.", 'fair-events' ); ?></strong></p>
			<p class="fair-events-get-tickets-callback-amount">
				<?php
				printf(
					/* translators: %s: formatted amount with currency */
					esc_html__( 'Amount due: %s', 'fair-events' ),
					esc_html( $amount_display )
				);
				?>
			</p>
			<?php if ( $all_purchases_blocked ) : ?>
				<div class="message-container message-error" role="alert">
					<?php esc_html_e( 'Ticket sales are temporarily unavailable. Please check back later.', 'fair-events' ); ?>
				</div>
			<?php else : ?>
				<div class="wp-block-button">
					<button type="button" class="wp-block-button__link wp-element-button fair-events-get-tickets-callback-retry-button">
						<?php esc_html_e( 'Retry payment', 'fair-events' ); ?>
					</button>
				</div>
			<?php endif; ?>
			<p class="fair-events-get-tickets-callback-cancel">
				<a href="#" class="fair-events-get-tickets-callback-cancel-link"><?php esc_html_e( 'Cancel and start over', 'fair-events' ); ?></a>
			</p>
			<div class="fair-events-get-tickets-callback-message message-container" style="display: none;"></div>
		</div>
	<?php endif; ?>
<?php elseif ( $all_purchases_blocked ) : ?>
	<div class="message-container message-error" role="alert">
		<?php esc_html_e( 'Ticket sales are temporarily unavailable. Please check back later.', 'fair-events' ); ?>
	</div>
<?php elseif ( $suppress_form ) : ?>
	<div class="fair-events-get-tickets-companion" data-event-date-id="<?php echo esc_attr( $event_date_id ); ?>">
		<?php
		/**
		 * Fires in place of the suppressed signup <form>. fair-audience uses
		 * this to render the signed-up/cancel card for a recognised viewer
		 * who already holds this signup.
		 *
		 * @param array $context Render context, see fair_events_signup_render_context.
		 */
		do_action( 'fair_events_signup_render_before_form', $context );
		?>
		<?php
		/**
		 * Fires in place of the suppressed signup <form>, after the
		 * before-form slot. fair-audience uses this for the add-activities
		 * section.
		 *
		 * @param array $context Render context, see fair_events_signup_render_context.
		 */
		do_action( 'fair_events_signup_render_after_form', $context );
		?>
	</div>
<?php else : ?>
	<form
		id="<?php echo esc_attr( $form_id ); ?>"
		class="fair-events-get-tickets-form"
		data-currency="<?php echo esc_attr( \FairEventsShared\Money::site_currency() ); ?>"
		data-event-date-id="<?php echo esc_attr( $event_date_id ); ?>"
		data-min-activities="<?php echo esc_attr( (string) $minimum_activities ); ?>"
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

		<?php if ( ! empty( $ticket_types ) ) : ?>
			<?php
			$first_enabled_type_id = null;
			foreach ( $ticket_types as $ticket_type ) {
				$type_id    = (int) $ticket_type->id;
				$type_price = $price_by_type_id[ $type_id ] ?? null;
				if ( ! ( $payments_unavailable && null !== $type_price && $type_price > 0 ) ) {
					$first_enabled_type_id = $type_id;
					break;
				}
			}
			?>
			<div class="form-row">
				<fieldset class="fair-events-ticket-fieldset">
					<legend class="form-label"><?php esc_html_e( 'Choose ticket type', 'fair-events' ); ?></legend>
					<?php foreach ( $ticket_types as $ticket_type ) : ?>
						<?php
						$type_id          = (int) $ticket_type->id;
						$type_price       = $price_by_type_id[ $type_id ] ?? null;
						$type_unavailable = $payments_unavailable && null !== $type_price && $type_price > 0;
						$label            = esc_html( $ticket_type->name );
						if ( null !== $type_price ) {
							$label .= ' — ' . esc_html( \FairEventsShared\Money::format_inline( $type_price ) );
						} elseif ( null === $active_sale_period ) {
							$label .= ' — ' . esc_html__( 'No active sale period', 'fair-events' );
						}
						if ( $type_unavailable ) {
							$label .= ' — ' . esc_html__( 'ticket sales temporarily unavailable', 'fair-events' );
						}
						$radio_id = $form_id . '-ticket-type-' . $type_id;
						?>
						<label class="fair-events-ticket-option" for="<?php echo esc_attr( $radio_id ); ?>">
							<input
								type="radio"
								id="<?php echo esc_attr( $radio_id ); ?>"
								name="ticket_type_id"
								value="<?php echo esc_attr( $type_id ); ?>"
								data-ticket-price="<?php echo esc_attr( null !== $type_price ? \FairEventsShared\Money::format_value( $type_price ) : '' ); ?>"
								data-recurrence-scope="<?php echo esc_attr( $ticket_type->recurrence_scope ); ?>"
								data-min-instances="<?php echo esc_attr( (string) $ticket_type->minimum_instances ); ?>"
								data-min-activities="<?php echo esc_attr( (string) $ticket_type->minimum_activities ); ?>"
								<?php echo $type_unavailable ? 'disabled' : ''; ?>
								<?php echo $type_id === $first_enabled_type_id ? 'checked' : ''; ?>
							/>
							<?php echo esc_html( $label ); ?>
						</label>
					<?php endforeach; ?>
				</fieldset>
			</div>
		<?php endif; ?>

		<?php if ( ! empty( $ticket_options ) ) : ?>
			<?php
			// Effective minimum for the type pre-selected on first paint (the
			// first not-payment-blocked type, mirroring the radio pre-selection
			// above) — frontend.js recomputes this live as the buyer switches
			// ticket type.
			$preselected_type_min = 0;
			if ( ! empty( $first_enabled_type_id ) ) {
				foreach ( $ticket_types as $tt_preselected ) {
					if ( (int) $tt_preselected->id === $first_enabled_type_id ) {
						$preselected_type_min = (int) $tt_preselected->minimum_activities;
						break;
					}
				}
			}
			// A minimum-activities requirement (global or ticket-type-raised)
			// switches option prices from an always-on inline price to a hidden
			// per-option "(+price)" add-on tag toggled by frontend.js once the
			// minimum is met, so the requirement reads clearly.
			$options_feature_active = ( $minimum_activities > 0 || $any_ticket_type_min > 0 );
			$initial_min_activities = min( count( $ticket_options ), max( $minimum_activities, $preselected_type_min ) );
			?>
			<div class="form-row">
				<fieldset class="fair-events-ticket-options">
					<legend class="form-label"><?php esc_html_e( 'Select activities', 'fair-events' ); ?></legend>
					<?php if ( $options_feature_active ) : ?>
						<?php
						$hint_text = $initial_min_activities > 0
							? sprintf(
								/* translators: %d: minimum number of activities required */
								_n(
									'Please select at least %d activity to sign up.',
									'Please select at least %d activities to sign up.',
									$initial_min_activities,
									'fair-events'
								),
								$initial_min_activities
							)
							: '';
						$hint_style = $initial_min_activities > 0 ? '' : ' style="display: none;"';
						?>
						<p class="fair-events-ticket-options-min-hint"<?php echo $hint_style; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static literal. ?>>
							<?php echo esc_html( $hint_text ); ?>
						</p>
					<?php endif; ?>
					<?php foreach ( $ticket_options as $opt ) : ?>
						<?php
						$opt_label = $opt['name'];
						if ( ! $options_feature_active ) {
							if ( $opt['price'] > 0 ) {
								$opt_label .= ' — ' . \FairEventsShared\Money::format_inline( $opt['price'] );
							} elseif ( $opt['price'] < 0 ) {
								$opt_label .= ' — -' . \FairEventsShared\Money::format_inline( abs( $opt['price'] ) );
							} else {
								$opt_label .= ' — ' . __( 'free', 'fair-events' );
							}
						}
						$opt_is_full = ! empty( $opt['is_full'] );
						if ( $opt_is_full ) {
							$opt_label .= ' — ' . __( 'full', 'fair-events' );
						}
						$opt_checkbox_id = $form_id . '-opt-' . (int) $opt['id'];
						$opt_classes     = 'fair-events-ticket-option-item';
						if ( $opt_is_full ) {
							$opt_classes .= ' fair-events-ticket-option-full';
						}
						?>
						<label class="<?php echo esc_attr( $opt_classes ); ?>" for="<?php echo esc_attr( $opt_checkbox_id ); ?>">
							<input
								type="checkbox"
								name="ticket_option_ids[]"
								id="<?php echo esc_attr( $opt_checkbox_id ); ?>"
								value="<?php echo (int) $opt['id']; ?>"
								class="form-checkbox"
								data-option-price="<?php echo esc_attr( \FairEventsShared\Money::format_value( $opt['price'] ) ); ?>"
								data-option-short-name="<?php echo esc_attr( $opt['short_name'] ?? '' ); ?>"
								<?php echo $opt_is_full ? 'disabled' : ''; ?>
							/>
							<span class="fair-events-ticket-option-text">
								<?php echo esc_html( $opt_label ); ?>
								<?php if ( $options_feature_active && $opt['price'] > 0 ) : ?>
									<span class="fair-events-ticket-option-addon" style="display: none;">
										<?php
										printf(
											/* translators: %s: formatted add-on price */
											esc_html__( '(+%s)', 'fair-events' ),
											esc_html( \FairEventsShared\Money::format_inline( $opt['price'] ) )
										);
										?>
									</span>
								<?php endif; ?>
							</span>
						</label>
					<?php endforeach; ?>
					<p class="fair-events-ticket-options-total"></p>
				</fieldset>
			</div>
		<?php endif; ?>

		<?php if ( $has_occurrence_dropdown ) : ?>
			<div class="form-row fair-events-occurrence-picker" style="display: none;">
				<label for="<?php echo esc_attr( $form_id ); ?>-occ" class="form-label">
					<?php esc_html_e( 'Choose a date', 'fair-events' ); ?>
				</label>
				<select id="<?php echo esc_attr( $form_id ); ?>-occ" name="event_date_id_single" class="form-input fair-events-occurrence-select">
					<?php foreach ( $occurrences_for_picker as $occ_index => $occ_row ) : ?>
						<?php
						$occ_label = \FairEvents\Helpers\DateRangeFormatter::format(
							$occ_row['start_datetime'],
							$occ_row['end_datetime'],
							$occ_row['all_day']
						);
						if ( ! empty( $occ_row['signed_up'] ) ) {
							$occ_label .= ' — ' . __( 'already signed up', 'fair-events' );
						}
						?>
						<option value="<?php echo (int) $occ_row['id']; ?>" <?php echo $occ_index === $default_occurrence_index ? 'selected' : ''; ?>>
							<?php echo esc_html( $occ_label ); ?>
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
					$occ_label     = \FairEvents\Helpers\DateRangeFormatter::format(
						$occ_row['start_datetime'],
						$occ_row['end_datetime'],
						$occ_row['all_day']
					);
					$occ_signed_up = ! empty( $occ_row['signed_up'] );
					if ( $occ_signed_up ) {
						$occ_label .= ' — ' . __( 'already signed up', 'fair-events' );
					}
					$checkbox_id = $form_id . '-inst-' . (int) $occ_row['id'];
					?>
					<label class="fair-events-instance-option" for="<?php echo esc_attr( $checkbox_id ); ?>">
						<input
							type="checkbox"
							name="event_date_ids[]"
							id="<?php echo esc_attr( $checkbox_id ); ?>"
							value="<?php echo (int) $occ_row['id']; ?>"
							class="form-checkbox"
							<?php echo $occ_signed_up ? 'disabled' : ''; ?>
						/>
						<?php echo esc_html( $occ_label ); ?>
					</label>
				<?php endforeach; ?>
				<p class="fair-events-instance-picker-hint"></p>
				<p class="fair-events-instance-picker-total"></p>
			</div>
		<?php endif; ?>

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

		<div class="fair-events-quantity-newsletter-row">
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
		</div>

		<?php if ( ! empty( $attributes['isEditorPreview'] ) ) : ?>
			<div class="fair-events-event-signup-questions-slot"></div>
		<?php elseif ( '' !== trim( $content ) ) : ?>
			<div class="fair-events-event-signup-questions">
				<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>
			</div>
		<?php endif; ?>

		<!-- Honeypot field (hidden from users, should remain empty) -->
		<input
			type="text"
			name="_honeypot"
			class="honeypot-field"
			tabindex="-1"
			autocomplete="off"
			aria-hidden="true"
		/>

		<?php
		/**
		 * Fires just inside the signup <form>, immediately before the submit
		 * button. fair-audience uses this to render a group discount note.
		 *
		 * @param array $context Render context, see fair_events_signup_render_context.
		 */
		do_action( 'fair_events_signup_render_before_submit', $context );
		?>

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

	<?php echo wp_kses_post( \FairEvents\Services\Branding::block_html() ); ?>
<?php endif; ?>
</div>
