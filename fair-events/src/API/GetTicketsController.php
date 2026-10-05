<?php
/**
 * REST API Controller for Get Tickets
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use FairEvents\Models\CheckoutKey;
use FairEventsShared\Money;

/**
 * Handles get-tickets REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GetTicketsController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'get-tickets';

	/**
	 * Rate limit: max requests per IP per window. Loose — a shared-NAT venue
	 * can still produce more than a handful of legitimate signups in an hour.
	 * The per-email limit below is the real abuse gate.
	 */
	const RATE_LIMIT_MAX_PER_IP = 20;

	/**
	 * Rate limit: max requests per email address per window.
	 */
	const RATE_LIMIT_MAX_PER_EMAIL = 3;

	/**
	 * Rate limit window in seconds (1 hour).
	 */
	const RATE_LIMIT_WINDOW = 3600;

	/**
	 * How long a repeated request waits for the request already finishing
	 * its checkout, in seconds.
	 */
	const CHECKOUT_WAIT_SECONDS = 8;

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-events/v1/get-tickets — public endpoint: anonymous ticket purchase.
		// Honeypot + server-side IP rate limit protect against abuse.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_signup' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'event_date_id'         => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'name'                  => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'                 => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'ticket_type_id'        => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
						'quantity'              => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 1,
							'sanitize_callback' => 'absint',
						),
						'mailing_opt_in'        => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
						'marketing_consent'     => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
						'meta_fbp'              => $this->meta_identifier_argument(),
						'meta_fbc'              => $this->meta_identifier_argument(),
						'meta_source_url'       => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'esc_url_raw',
							'validate_callback' => static function ( $value ) {
								return '' === $value || (bool) wp_http_validate_url( $value );
							},
						),
						'participant_token'     => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						// Chosen occurrence IDs for 'multiple_instances' ticket types.
						// Capped so a crafted request can't force an unbounded number
						// of line items / DB rows per submission.
						'event_date_ids'        => array(
							'type'              => 'array',
							'items'             => array( 'type' => 'integer' ),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
							},
						),
						// Chosen activity (ticket option) IDs for a single
						// ticket. Capped, mirroring event_date_ids above.
						// Ignored on the 'multiple_instances' path, which never
						// reads this param.
						'ticket_option_ids'     => array(
							'type'              => 'array',
							'items'             => array( 'type' => 'integer' ),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
							},
						),
						// Chosen activity IDs for each ticket, one list per
						// ticket in order (#1697). Required instead of
						// ticket_option_ids when buying several tickets with
						// activities. Capped like the lists above.
						'ticket_activities'     => array(
							'type'              => 'array',
							'items'             => array(
								'type'  => 'array',
								'items' => array( 'type' => 'integer' ),
							),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								if ( ! is_array( $value ) ) {
									return true;
								}
								if ( count( $value ) > 100 ) {
									return false;
								}
								foreach ( $value as $unit ) {
									if ( is_array( $unit ) && count( $unit ) > 50 ) {
										return false;
									}
								}
								return true;
							},
						),
						'_honeypot'             => array(
							'type'     => 'string',
							'required' => false,
							'default'  => '',
						),
						// Identifies one intended purchase (#1534). A request
						// repeated with the same key returns the purchase it
						// already created instead of creating, reserving or
						// charging again; a new purchase sends a new key.
						'idempotency_key'       => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
							'validate_callback' => static function ( $value ) {
								return '' === $value || ( is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $value ) );
							},
						),
						// No 'type' declared: QuestionnaireService::parse_answers()
						// handles both a decoded array and a raw JSON string.
						// Capped at 50 answers, mirroring the event_date_ids cap above.
						'questionnaire_answers' => array(
							'required'          => false,
							'default'           => array(),
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
							},
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'event_date'      => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'include_answers' => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
				// Move a signup to another occurrence, or give it another
				// ticket type (#1532). Send exactly one of event_date_id or
				// ticket_type_id; override_reason confirms going past a limit.
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id'              => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'   => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'ticket_type_id'  => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'override_reason' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);

		// GET /fair-events/v1/get-tickets/{id}/targets — the occurrences and
		// ticket types a signup can be moved to, with the places left on each.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)/targets',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_edit_targets' ),
				'permission_callback' => array( $this, 'admin_permissions_check' ),
				'args'                => array(
					'id' => array(
						'type'              => 'integer',
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		// GET /fair-events/v1/get-tickets/viewer-context — request-time-only
		// per-viewer personalization (restricted tiers, discounted prices,
		// prefill, signed-up state) for the cache-safe baseline render's
		// occurrence, resolved outside the base render so a full-page cache
		// never stores another viewer's tiers, prices, or details (#1300).
		// permission_callback: __return_true is safe here — the optional
		// participant token is HMAC-validated by the companion before it can
		// affect any response data; anonymous callers receive the no-op payload.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/viewer-context',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_viewer_context' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'event_date_id'      => array(
						'type'              => 'integer',
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
					// Block-author display choices, viewer-independent — read
					// from the baseline render's data attributes by
					// frontend.js so the personalized fragments match it.
					'show_ticket_price'  => array(
						'type'              => 'boolean',
						'required'          => false,
						'default'           => true,
						'sanitize_callback' => 'rest_sanitize_boolean',
					),
					'show_option_prices' => array(
						'type'              => 'boolean',
						'required'          => false,
						'default'           => true,
						'sanitize_callback' => 'rest_sanitize_boolean',
					),
					'participant_token'  => array(
						'type'              => 'string',
						'required'          => false,
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);

		// GET /fair-events/v1/get-tickets/payment-state — resolved
		// confirmed/processing/resume/retry state + card payload. Consumed by
		// the return-from-payment callback card and the direct-navigation
		// in-progress card poller. transaction_id/token are optional: when
		// absent, ownership resolves from the SignupPaymentSession cookie.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/payment-state',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_payment_state' ),
				'permission_callback' => array( $this, 'signup_payment_permissions_check' ),
				'args'                => array(
					'transaction_id' => array(
						'type'              => 'integer',
						'required'          => false,
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
					'token'          => array(
						'type'              => 'string',
						'required'          => false,
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);

		// POST /fair-events/v1/get-tickets/retry-payment — re-initiate a
		// failed/canceled/expired (or checkout-link-less) payment.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/retry-payment',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'retry_payment' ),
				'permission_callback' => array( $this, 'signup_payment_permissions_check' ),
				'args'                => array(
					'transaction_id'    => array(
						'type'              => 'integer',
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
					'token'             => array(
						'type'              => 'string',
						'required'          => false,
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'marketing_consent' => array(
						'type'              => 'boolean',
						'required'          => false,
						'default'           => false,
						'sanitize_callback' => 'rest_sanitize_boolean',
					),
					'meta_fbp'          => $this->meta_identifier_argument(),
					'meta_fbc'          => $this->meta_identifier_argument(),
					'meta_source_url'   => array(
						'type'              => 'string',
						'required'          => false,
						'default'           => '',
						'sanitize_callback' => 'esc_url_raw',
					),
				),
			)
		);

		// POST /fair-events/v1/get-tickets/cancel-payment — mark the
		// in-progress signup row(s) failed and clear the session cookie, so
		// "Cancel and start over" doesn't resurrect the same checkout.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/cancel-payment',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'cancel_payment' ),
				'permission_callback' => array( $this, 'signup_payment_permissions_check' ),
				'args'                => array(
					'transaction_id' => array(
						'type'              => 'integer',
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
					'token'          => array(
						'type'              => 'string',
						'required'          => false,
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);
	}

	/**
	 * Create a ticket signup.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_signup( $request ) {
		// Honeypot check — silently succeed to avoid enumeration.
		if ( ! empty( $request->get_param( '_honeypot' ) ) ) {
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'Thank you!', 'fair-events' ),
				)
			);
		}

		$event_date_id     = $request->get_param( 'event_date_id' );
		$name              = $request->get_param( 'name' );
		$email             = $request->get_param( 'email' );
		$ticket_type_id    = $request->get_param( 'ticket_type_id' );
		$quantity          = max( 1, min( 100, (int) $request->get_param( 'quantity' ) ) );
		$mailing_opt_in    = (bool) $request->get_param( 'mailing_opt_in' );
		$participant_token = (string) $request->get_param( 'participant_token' );
		$idempotency_key   = (string) $request->get_param( 'idempotency_key' );
		$fingerprint       = '' !== $idempotency_key ? $this->checkout_fingerprint( $request ) : '';

		// A request repeated with a known key resolves to the purchase it
		// already created — before the rate limit, so a retry does not use
		// up another attempt, and before any check whose answer may have
		// changed since (capacity, price, availability).
		if ( '' !== $idempotency_key ) {
			$existing = CheckoutKey::find( $idempotency_key );
			if ( $existing ) {
				return $this->replay_checkout( $request, $existing, $fingerprint );
			}
		}

		// Server-side rate limit by IP and by email. The IP ceiling is loose
		// enough that a shared-NAT venue's fourth signup that hour doesn't
		// 429; the tighter per-email limit is what actually stops abuse once
		// this is the only signup path (#1245 cutover).
		if ( $this->is_rate_limited( $email ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-events' ),
				array( 'status' => 429 )
			);
		}

		// Chosen activities, one list per ticket. Several tickets must each
		// name their own; one list is never copied across the quantity.
		$unit_option_ids = $this->resolve_unit_option_ids( $request, $quantity );
		if ( is_wp_error( $unit_option_ids ) ) {
			return $unit_option_ids;
		}
		$ticket_option_ids = array_values( array_unique( array_merge( array(), ...$unit_option_ids ) ) );

		// Validated here, before any signup is written; saved with the
		// signup's hooks (see fire_checkout_hooks()).
		$questionnaire_answers = $this->prepare_questionnaire_answers( $request );
		if ( is_wp_error( $questionnaire_answers ) ) {
			return $questionnaire_answers;
		}

		// Validate event date exists.
		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Extension point for plugins that need to reject a signup before any
		// row is written. Runs before ticket-type/options validation so it
		// covers the single-, multiple-instances- and no-ticket-type paths
		// alike. A participant already holding a ticket is no reason to
		// reject: every checkout is its own purchase. See REST_API_BACKEND.md.
		$precheck_error = apply_filters( 'fair_events_signup_precheck_error', null, (int) $event_date_id, $email, (int) $ticket_type_id, $participant_token );
		if ( is_wp_error( $precheck_error ) ) {
			return $precheck_error;
		}

		// Extension point for plugins (e.g. fair-audience) that answer a
		// submission themselves instead of letting it be saved now — a typed
		// email that belongs to someone the browser is not known to be, who
		// then continues from a link sent to that address. Runs before any
		// signup, participant link or payment exists. Only sanitized values
		// are handed over. See REST_API_BACKEND.md.
		$deferred_response = apply_filters(
			'fair_events_signup_deferred_response',
			null,
			array(
				'event_date_id'         => (int) $event_date_id,
				'name'                  => $name,
				'email'                 => $email,
				'ticket_type_id'        => (int) $ticket_type_id,
				'quantity'              => $quantity,
				'mailing_opt_in'        => $mailing_opt_in,
				'ticket_option_ids'     => $ticket_option_ids,
				'ticket_activities'     => $unit_option_ids,
				'event_date_ids'        => array_values( array_filter( array_map( 'absint', (array) $request->get_param( 'event_date_ids' ) ) ) ),
				'questionnaire_answers' => $questionnaire_answers,
			),
			$participant_token
		);
		if ( null !== $deferred_response ) {
			// Counts as an attempt, so the answer cannot be requested without limit.
			$this->increment_rate_limit( $email );
			return rest_ensure_response( $deferred_response );
		}

		// Validate ticket type belongs to this event date (or its series master)
		// and has not been disabled.
		$amount               = 0.00;
		$config_event_date_id = $this->resolve_master_event_date_id( $event_date_id );
		if ( ! $config_event_date_id ) {
			$config_event_date_id = $event_date_id;
		}
		if ( $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( ! $ticket_type
				|| ( (int) $ticket_type->event_date_id !== (int) $event_date_id
					&& (int) $ticket_type->event_date_id !== (int) $config_event_date_id ) ) {
				return new WP_Error(
					'invalid_ticket_type',
					__( 'Invalid ticket type.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			if ( ! \FairEvents\Services\TicketPricing::is_ticket_type_enabled( $ticket_type ) ) {
				return new WP_Error(
					'ticket_type_disabled',
					__( 'This ticket type is no longer available.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}

			// Extension point for plugins (e.g. fair-audience) that restrict a
			// ticket type to specific groups. Applies to both the single- and
			// multiple_instances paths below, since this runs before either
			// dispatches. See REST_API_BACKEND.md.
			$restriction_error = apply_filters( 'fair_events_signup_ticket_type_error', null, (int) $ticket_type_id, (int) $event_date_id, $participant_token );
			if ( is_wp_error( $restriction_error ) ) {
				return $restriction_error;
			}

			// 'multiple_instances' ticket types pick several specific occurrences
			// instead of the single event_date_id above — handled by a dedicated
			// path that creates one signup row per chosen occurrence.
			if ( $ticket_type->is_multiple_instances() ) {
				$this->increment_rate_limit( $email );
				return $this->create_multi_instance_signup( $request, $ticket_type, $event_date_id, $name, $email, $mailing_opt_in, $idempotency_key, $fingerprint );
			}

			// Resolve price from the active sale period (server-side; client amount is ignored).
			// The filter is the extension point a companion plugin uses to apply
			// participant-specific discounts on top of this base price.
			$unit_price = \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type_id );
			$unit_price = apply_filters( 'fair_events_signup_unit_price', $unit_price, (int) $ticket_type_id, (int) $event_date_id, $participant_token );
			if ( null === $unit_price ) {
				return new WP_Error(
					'ticket_type_unavailable',
					__( 'This ticket type is not currently on sale.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
			$amount = $unit_price * $quantity;
		}

		$unit_options = $this->load_unit_options( $unit_option_ids, (int) $config_event_date_id );
		if ( is_wp_error( $unit_options ) ) {
			return $unit_options;
		}

		// Validate each distinct selection among the tickets: the activities
		// belong to the event, are on sale and have a place left, and the
		// selection satisfies the ticket type's activity rule. Runs
		// unconditionally — even a signup with no ticket type can carry a
		// minimum-activities requirement. Capacity across all tickets is
		// enforced below, under the lock. The filter lets a companion plugin
		// add its own restriction. See REST_API_BACKEND.md.
		$validated_selections = array();
		foreach ( $unit_option_ids as $selection ) {
			$selection_key = implode( ',', $selection );
			if ( isset( $validated_selections[ $selection_key ] ) ) {
				continue;
			}
			$validated_selections[ $selection_key ] = true;

			$options_error = \FairEvents\Services\ActivitySelection::validate( $selection, (int) $config_event_date_id, (int) $ticket_type_id, (int) $event_date_id );
			$options_error = apply_filters( 'fair_events_signup_options_error', $options_error, $selection, (int) $config_event_date_id, (int) $ticket_type_id, $participant_token, (int) $event_date_id );
			if ( is_wp_error( $options_error ) ) {
				return $options_error;
			}
		}

		// Each activity is priced once and charged for every ticket that
		// selected it, as its own line item so the finance ledger names what
		// was bought instead of folding it into the ticket line.
		$option_line_items = $this->option_line_items( $unit_options, (int) $config_event_date_id, $participant_token );
		if ( is_wp_error( $option_line_items ) ) {
			return $option_line_items;
		}
		$ticket_amount = $amount;
		foreach ( $option_line_items as $item ) {
			$amount += (float) $item['quantity'] * (float) $item['amount'];
		}

		// Fail closed: a priced ticket must never be saved when payment can't
		// be collected. Rejecting up front avoids the orphaned pending_payment
		// row left by the connector-unconfigured case and the silent
		// free-confirmation the old connector-absent fallback produced. Covers
		// activity-only pricing too (free ticket type + paid activity), since
		// $amount already includes the options total above.
		if ( $amount > 0 && $this->payments_unavailable() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid tickets are not available because online payments are not configured.', 'fair-events' ),
				array( 'status' => 503 )
			);
		}

		$this->increment_rate_limit( $email );

		$ticket_selection = array(
			'ticket_type_id'    => $ticket_type_id ? $ticket_type_id : null,
			'quantity'          => $quantity,
			'ticket_option_ids' => $ticket_option_ids,
			'ticket_activities' => $unit_option_ids,
			// The activities are stored on the tickets with the signup.
			'activities_stored' => true,
			'mailing_opt_in'    => $mailing_opt_in,
		);

		// Paid path — payments were confirmed available above (see the
		// fail-closed guard), so the payment is planned here, at the prices
		// just resolved, and carried out once the signup is saved.
		$payment = null;
		if ( $amount > 0 ) {
			$event_title = $this->resolve_event_title( $event_date );
			$description = $event_title
				? sprintf(
					/* translators: %s: event name */
					__( 'Ticket for %s', 'fair-events' ),
					$event_title
				)
				: sprintf(
					/* translators: %d: event date ID */
					__( 'Ticket for event #%d', 'fair-events' ),
					$event_date_id
				);

			// Activities get their own line item(s) (from $option_line_items,
			// resolved above) instead of being folded into the ticket line, so the
			// finance ledger names what was bought. The ticket line is only added
			// when there's an actual ticket price — a pure activity-only signup
			// (free/no ticket type + paid activity) skips a nonsensical €0 line.
			$line_items = array();
			if ( $ticket_amount > 0 ) {
				$line_items[] = array(
					'name'     => $description,
					'quantity' => $quantity,
					'amount'   => $ticket_amount / $quantity,
				);
			}
			foreach ( $option_line_items as $item ) {
				$line_items[] = $item;
			}

			$payment = array(
				'line_items'    => $line_items,
				'description'   => $description,
				'currency'      => Money::site_currency(),
				'event_date_id' => (int) $event_date_id,
			);
		}

		// Check the event, ticket-type and activity limits and persist the
		// signup row, its tickets and their activities under the same row
		// locks, so concurrent buyers can't both take the last place. A paid
		// signup is saved holding its places until its payment hold expires.
		$checkout = $this->reserve_checkout(
			$idempotency_key,
			$fingerprint,
			array(
				'ticket_selection' => $ticket_selection,
				'amount'           => $amount,
				'payment'          => $payment,
				'shared'           => false,
			),
			array(
				array(
					'event_date_id'  => (int) $event_date_id,
					'ticket_type_id' => (int) $ticket_type_id,
					'quantity'       => $quantity,
					'option_ids'     => array_merge( array(), ...$unit_option_ids ),
				),
			),
			static function () use ( $event_date_id, $ticket_type_id, $name, $email, $quantity, $mailing_opt_in, $amount, $unit_options ) {
				$signup_id = \FairEvents\Models\EventSignup::save_in_transaction(
					array(
						'event_date_id'  => $event_date_id,
						'ticket_type_id' => $ticket_type_id ? $ticket_type_id : null,
						'name'           => $name,
						'email'          => $email,
						'quantity'       => $quantity,
						'mailing_opt_in' => $mailing_opt_in ? 1 : 0,
						'amount'         => $amount,
						'status'         => $amount > 0 ? 'pending_payment' : 'confirmed',
					)
				);
				if ( ! $signup_id ) {
					return false;
				}

				// The ticket's own status decides whether its activities
				// count, so they are written confirmed even while payment is
				// pending (see EventTicketActivity).
				$tickets = \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup_id );
				foreach ( $unit_options as $position => $options ) {
					if ( ! $options ) {
						continue;
					}
					if ( ! isset( $tickets[ $position ] )
						|| ! \FairEvents\Models\EventTicketActivity::confirm( (int) $tickets[ $position ]->id, $options )
					) {
						return false;
					}
				}

				return array( (int) $signup_id );
			}
		);

		if ( is_wp_error( $checkout ) ) {
			return $checkout;
		}

		if ( isset( $checkout['replay'] ) ) {
			return $this->replay_checkout( $request, $checkout['replay'], $fingerprint );
		}

		return $this->finish_checkout( $request, $checkout );
	}

	/**
	 * Fingerprint the purchase details of a request, so a key reused for a
	 * different purchase is refused instead of returning the first one.
	 * Leaves out what does not describe the purchase: the credential,
	 * tracking identifiers and the honeypot.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return string
	 */
	private function checkout_fingerprint( $request ) {
		$ids = static function ( $values ) {
			$values = array_values( array_filter( array_unique( array_map( 'absint', (array) $values ) ) ) );
			sort( $values );
			return $values;
		};

		$activities = $request->get_param( 'ticket_activities' );
		$answers    = $request->get_param( 'questionnaire_answers' );
		if ( is_string( $answers ) ) {
			$decoded = json_decode( $answers, true );
			$answers = is_array( $decoded ) ? $decoded : $answers;
		}

		return hash(
			'sha256',
			(string) wp_json_encode(
				array(
					'event_date_id'         => (int) $request->get_param( 'event_date_id' ),
					'name'                  => (string) $request->get_param( 'name' ),
					'email'                 => strtolower( (string) $request->get_param( 'email' ) ),
					'ticket_type_id'        => (int) $request->get_param( 'ticket_type_id' ),
					'quantity'              => max( 1, min( 100, (int) $request->get_param( 'quantity' ) ) ),
					'event_date_ids'        => $ids( $request->get_param( 'event_date_ids' ) ?? array() ),
					'ticket_option_ids'     => $ids( $request->get_param( 'ticket_option_ids' ) ?? array() ),
					// One list per ticket: their order is part of the purchase.
					'ticket_activities'     => is_array( $activities ) ? array_map( $ids, array_values( $activities ) ) : array(),
					'mailing_opt_in'        => (bool) $request->get_param( 'mailing_opt_in' ),
					'questionnaire_answers' => $answers ? $answers : array(),
				)
			)
		);
	}

	/**
	 * Save a checkout's signup rows once every place they need is available,
	 * and — for a request carrying an idempotency key — record the key with
	 * them, in the same transaction and under the same capacity locks. Two
	 * requests with one key therefore run one after the other, and the
	 * second finds the first one's record instead of checking capacity or
	 * saving again.
	 *
	 * @param string   $idempotency_key Idempotency key, or '' for none.
	 * @param string   $fingerprint     Fingerprint of the purchase details.
	 * @param array    $context         What finishing the checkout needs: 'ticket_selection', 'amount',
	 *                                  'payment' (line_items, description, currency, event_date_id; null when
	 *                                  free) and 'shared' (several signups under one transaction).
	 * @param array[]  $demands         Places needed, see TicketCapacity::reserve().
	 * @param callable $save            Saves the signup rows; returns their IDs or false.
	 * @return array|WP_Error The new checkout, array( 'replay' => record ) when the key already
	 *                        has a purchase, or an error.
	 */
	private function reserve_checkout( $idempotency_key, $fingerprint, array $context, array $demands, callable $save ) {
		$claim_token = wp_generate_password( 32, false );
		$key_id      = 0;

		$result = \FairEvents\Services\TicketCapacity::reserve(
			$demands,
			static function () use ( $idempotency_key, $fingerprint, $context, $claim_token, $save, &$key_id ) {
				if ( '' !== $idempotency_key ) {
					$key_id = (int) CheckoutKey::create( $idempotency_key, $fingerprint, $context, $claim_token );
					if ( ! $key_id ) {
						return false;
					}
				}

				$signup_ids = $save();
				if ( ! $signup_ids ) {
					return false;
				}

				if ( $key_id && ! CheckoutKey::set_signup_ids( $key_id, $signup_ids ) ) {
					return false;
				}

				return array_map( 'intval', $signup_ids );
			},
			'' === $idempotency_key
				? null
				: static function () use ( $idempotency_key ) {
					return CheckoutKey::find( $idempotency_key );
				}
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		if ( is_object( $result ) ) {
			return array( 'replay' => $result );
		}

		if ( ! $result ) {
			// A request with the same key may have recorded it meanwhile.
			$existing = '' !== $idempotency_key ? CheckoutKey::find( $idempotency_key ) : null;
			if ( $existing ) {
				return array( 'replay' => $existing );
			}

			return new WP_Error(
				'db_error',
				__( 'Failed to save signup. Please try again.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return array(
			'id'          => $key_id,
			'state'       => CheckoutKey::STATE_OPEN,
			'claim_token' => $claim_token,
			'signup_ids'  => $result,
			'context'     => $context,
			'hooks_fired' => false,
		);
	}

	/**
	 * Answer a request whose idempotency key already has a purchase: return
	 * that purchase's result, never a new signup, reservation or charge.
	 *
	 * A checkout that was interrupted (the first request failed part-way,
	 * e.g. at the payment provider) is continued from what was saved. While
	 * the first request is still finishing it, this one waits for its result.
	 *
	 * @param WP_REST_Request $request     Request object.
	 * @param object          $record      Checkout key row.
	 * @param string          $fingerprint Fingerprint of this request's purchase details.
	 * @return WP_REST_Response|WP_Error
	 */
	private function replay_checkout( $request, $record, $fingerprint ) {
		if ( ! hash_equals( (string) $record->fingerprint, (string) $fingerprint ) ) {
			return new WP_Error(
				'idempotency_key_reused',
				__( 'This purchase was already submitted with different details. Reload the page and try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		$claim_token = '';
		if ( CheckoutKey::STATE_OPEN === $record->state ) {
			$claim_token = wp_generate_password( 32, false );
			$claimed     = $this->claim_checkout( (int) $record->id, $claim_token );
			$record      = CheckoutKey::get_by_id( (int) $record->id );

			if ( ! $record ) {
				return $this->checkout_closed_error();
			}

			if ( CheckoutKey::STATE_OPEN === $record->state && ! $claimed ) {
				return $this->checkout_in_progress_error();
			}
		}

		return $this->finish_checkout(
			$request,
			array(
				'id'          => (int) $record->id,
				'state'       => (string) $record->state,
				'claim_token' => $claim_token,
				'signup_ids'  => CheckoutKey::signup_ids( $record ),
				'context'     => CheckoutKey::context( $record ),
				'hooks_fired' => (bool) $record->hooks_fired,
			)
		);
	}

	/**
	 * Claim an open checkout to continue it, waiting a moment for the
	 * request that is finishing it.
	 *
	 * @param int    $checkout_id Checkout key row ID.
	 * @param string $claim_token Claim token of this request.
	 * @return bool True when this request holds the claim; false when the checkout
	 *              was finished meanwhile or is still being worked on.
	 */
	private function claim_checkout( $checkout_id, $claim_token ) {
		$deadline = microtime( true ) + self::CHECKOUT_WAIT_SECONDS;

		do {
			if ( CheckoutKey::claim( $checkout_id, $claim_token ) ) {
				return true;
			}

			$record = CheckoutKey::get_by_id( $checkout_id );
			if ( ! $record || CheckoutKey::STATE_OPEN !== $record->state ) {
				return false;
			}

			usleep( 200000 );
		} while ( microtime( true ) < $deadline );

		return false;
	}

	/**
	 * Carry a checkout to its result and record how far it got: finished,
	 * ended, or — after an error it can recover from — left open for the
	 * next request with its key.
	 *
	 * @param WP_REST_Request $request  Request object.
	 * @param array           $checkout Checkout, see reserve_checkout().
	 * @return WP_REST_Response|WP_Error
	 */
	private function finish_checkout( $request, array $checkout ) {
		$result = $this->advance_checkout( $request, $checkout );

		if ( $checkout['id'] && CheckoutKey::STATE_OPEN === $checkout['state'] ) {
			if ( is_wp_error( $result ) && 'checkout_closed' !== $result->get_error_code() ) {
				// Only gives up this request's own claim; a no-op when
				// another request took the checkout over.
				CheckoutKey::release_claim( $checkout['id'], $checkout['claim_token'] );
			} else {
				CheckoutKey::complete( $checkout['id'] );
			}
		}

		return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
	}

	/**
	 * Take a checkout from wherever it stands to its response. Every step
	 * reads what the previous ones persisted, so it gives the same result
	 * whether run by the request that created the checkout, by one
	 * continuing it after an interruption, or by one repeating a finished
	 * checkout's key:
	 *
	 * - the signups' payment transaction is created only when they have none;
	 * - the signup hooks run only once;
	 * - a payment is started only for a transaction that has none, and an
	 *   open one is returned as it is (TransactionAPI::resume_payment()).
	 *
	 * Only an open checkout is advanced; a finished one just reports where
	 * its purchase stands. A purchase that can no longer be paid (failed,
	 * cancelled, expired) is closed: its key never starts another one.
	 *
	 * @param WP_REST_Request $request  Request object.
	 * @param array           $checkout Checkout, see reserve_checkout().
	 * @return array|WP_Error Response data, or an error.
	 */
	private function advance_checkout( $request, array $checkout ) {
		$signups = array_values(
			array_filter(
				array_map(
					static function ( $signup_id ) {
						return \FairEvents\Models\EventSignup::get_by_id( (int) $signup_id );
					},
					$checkout['signup_ids']
				)
			)
		);
		if ( ! $signups || count( $signups ) !== count( $checkout['signup_ids'] ) ) {
			return $this->checkout_closed_error();
		}

		$open      = CheckoutKey::STATE_OPEN === $checkout['state'];
		$payment   = $checkout['context']['payment'] ?? null;
		$confirmed = array(
			'status'  => 'confirmed',
			'message' => __( 'You have successfully registered! A confirmation email is on its way.', 'fair-events' ),
		);

		// Free path.
		if ( ! $payment ) {
			if ( ! $checkout['hooks_fired'] ) {
				if ( ! $open ) {
					return $this->checkout_closed_error();
				}
				$this->fire_checkout_hooks( $request, $checkout, $signups, null );
			}

			return $confirmed;
		}

		$all_confirmed = true;
		$holds_places  = true;
		foreach ( $signups as $signup ) {
			$all_confirmed = $all_confirmed && 'confirmed' === $signup->status;
			$holds_places  = $holds_places && \FairEvents\Services\TicketCapacity::signup_holds_places( $signup );
		}
		if ( $all_confirmed ) {
			return $confirmed;
		}

		// A retried payment moved the signups to a newer transaction; the
		// one they carry now is the one that counts.
		$transaction_id = (int) $signups[0]->transaction_id;
		$transaction    = $transaction_id ? \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id ) : null;
		if ( $transaction && 'paid' === $transaction->status ) {
			return $confirmed;
		}

		// The payment failed, was cancelled, or its hold ran out: the places
		// are released, so nothing more is charged for this checkout.
		if ( ! $holds_places ) {
			return $this->checkout_closed_error();
		}

		if ( ! $transaction ) {
			if ( ! $open ) {
				return $this->checkout_closed_error();
			}

			$transaction_id = $this->create_checkout_transaction( $request, $checkout, $signups );
			if ( is_wp_error( $transaction_id ) ) {
				return $transaction_id;
			}
		}

		if ( ! $checkout['hooks_fired'] ) {
			if ( ! $open ) {
				return $this->checkout_closed_error();
			}
			$this->fire_checkout_hooks( $request, $checkout, $signups, $transaction_id );
		}

		// Load the transaction so its access token can be attached to the
		// redirect URL, mirroring PaymentEndpoint::create_payment. The token
		// gates the shared /payments/{id}/status endpoint this now polls.
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		if ( ! $transaction ) {
			return $this->checkout_closed_error();
		}

		if ( 'draft' === $transaction->status ) {
			// Starting the payment is the one step that must not run twice:
			// only the request still holding the checkout's claim does it.
			if ( ! $open ) {
				return $this->checkout_closed_error();
			}
			if ( $checkout['id'] && ! CheckoutKey::renew_claim( $checkout['id'], $checkout['claim_token'] ) ) {
				return $this->checkout_in_progress_error();
			}
		}

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'token'                 => $transaction->access_token,
			),
			$this->resolve_return_url( (int) $request->get_param( 'event_date_id' ) )
		);

		$started = \FairPaymentsConnector\API\TransactionAPI::resume_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $started ) ) {
			if ( 'payment_not_resumable' !== $started->get_error_code() ) {
				return $started;
			}

			// 'pending' is a payment in flight at the bank: neither payable
			// again nor over.
			return 'pending' === $transaction->status
				? new WP_Error(
					'payment_processing',
					__( 'Your payment is being processed. You will receive a confirmation email once it is complete.', 'fair-events' ),
					array( 'status' => 409 )
				)
				: $this->checkout_closed_error();
		}

		\FairEvents\Services\SignupPaymentSession::set( (int) $signups[0]->id, $transaction_id );

		return array(
			'status'         => 'payment_required',
			'checkout_url'   => esc_url_raw( $started['checkout_url'] ),
			'transaction_id' => $transaction_id,
			'amount'         => $checkout['context']['amount'],
			'currency'       => $payment['currency'],
		);
	}

	/**
	 * Create the transaction a checkout's signups are paid with, from the
	 * payment planned when they were saved, and attach it to them.
	 *
	 * @param WP_REST_Request $request  Request object.
	 * @param array           $checkout Checkout, see reserve_checkout().
	 * @param object[]        $signups  The checkout's signup rows.
	 * @return int|WP_Error Transaction ID, or an error.
	 */
	private function create_checkout_transaction( $request, array $checkout, array $signups ) {
		$payment    = $checkout['context']['payment'];
		$email      = (string) $signups[0]->email;
		$user_id    = get_current_user_id();
		$signup_ids = array_map(
			static function ( $signup ) {
				return (int) $signup->id;
			},
			$signups
		);

		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$payment['line_items'],
			array(
				'currency'       => $payment['currency'],
				'description'    => $payment['description'],
				'event_date_id'  => (int) $payment['event_date_id'],
				'post_id'        => $this->resolve_event_post_id( (int) $payment['event_date_id'] ),
				'user_id'        => $user_id ? $user_id : null,
				'participant_id' => $this->resolve_transaction_participant_id( $signup_ids, $email, (string) $request->get_param( 'participant_token' ) ),
				'email'          => $email,
				'metadata'       => array_merge(
					array(
						'source'        => 'fair-events-get-tickets',
						'event_date_id' => (int) $payment['event_date_id'],
					),
					// A 'multiple_instances' purchase stores one signup row ID per chosen occurrence.
					empty( $checkout['context']['shared'] ) ? array( 'signup_id' => $signup_ids[0] ) : array( 'signup_ids' => $signup_ids ),
					array( 'email' => $email ),
					$this->get_meta_attribution( $request )
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		foreach ( $signup_ids as $signup_id ) {
			\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );
		}

		return (int) $transaction_id;
	}

	/**
	 * Run a checkout's signup hooks, once: the companion plugin's
	 * participant link and confirmation for each signup row, the buyer's
	 * custom-question answers, and — when paid — the transaction link.
	 *
	 * @param WP_REST_Request $request        Request object.
	 * @param array           $checkout       Checkout, see reserve_checkout().
	 * @param object[]        $signups        The checkout's signup rows.
	 * @param int|null        $transaction_id Transaction paying for them, or null on the free path.
	 * @return void
	 */
	private function fire_checkout_hooks( $request, array $checkout, array $signups, $transaction_id ) {
		$ticket_selection  = $checkout['context']['ticket_selection'] ?? array();
		$participant_token = (string) $request->get_param( 'participant_token' );
		$answers           = $this->prepare_questionnaire_answers( $request );
		if ( is_wp_error( $answers ) ) {
			$answers = array();
		}

		$signup_ids = array();
		foreach ( $signups as $signup ) {
			$signup_ids[] = (int) $signup->id;
			$this->fire_signup_created( (int) $signup->id, (int) $signup->event_date_id, (string) $signup->name, (string) $signup->email, $ticket_selection, $transaction_id, $participant_token );
			$this->persist_questionnaire_answers( (int) $signup->id, (int) $signup->event_date_id, $answers );
		}

		if ( $transaction_id ) {
			$this->fire_signup_transaction_created( (int) $transaction_id, $signup_ids );
		}

		if ( $checkout['id'] ) {
			CheckoutKey::mark_hooks_fired( $checkout['id'] );
		}
	}

	/**
	 * Error for a key whose purchase is over without being confirmed. The
	 * key stays used: buying again takes a new key.
	 *
	 * @return WP_Error
	 */
	private function checkout_closed_error() {
		return new WP_Error(
			'checkout_closed',
			__( 'This purchase has ended and can no longer be paid. Submit the form again to start a new one.', 'fair-events' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * Error for a key whose checkout another request is still finishing.
	 *
	 * @return WP_Error
	 */
	private function checkout_in_progress_error() {
		return new WP_Error(
			'checkout_in_progress',
			__( 'This purchase is still being processed. Please wait a moment and try again.', 'fair-events' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * Resolve the activities chosen for each ticket of a purchase. Several
	 * tickets need ticket_activities, one list per ticket; a single ticket
	 * may send ticket_option_ids instead. A single list sent with several
	 * tickets is refused rather than copied to each or used for just one.
	 *
	 * @param WP_REST_Request $request  Request object.
	 * @param int             $quantity Number of tickets bought.
	 * @return int[][]|WP_Error One list of option IDs per ticket, in ticket order.
	 */
	private function resolve_unit_option_ids( $request, $quantity ) {
		$normalize = static function ( $ids ) {
			return array_values( array_filter( array_unique( array_map( 'absint', (array) $ids ) ) ) );
		};

		$single = $normalize( $request->get_param( 'ticket_option_ids' ) ?? array() );
		$units  = $request->get_param( 'ticket_activities' );

		if ( is_array( $units ) ) {
			if ( $single ) {
				return new WP_Error(
					'ambiguous_activity_selection',
					__( 'Send activities either for each ticket or for a single ticket, not both.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			if ( count( $units ) !== (int) $quantity ) {
				return new WP_Error(
					'activity_selection_mismatch',
					__( 'Choose the activities for each ticket.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}

			return array_map( $normalize, array_values( $units ) );
		}

		if ( $single && $quantity > 1 ) {
			return new WP_Error(
				'activity_selection_mismatch',
				__( 'Choose the activities for each ticket.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$unit_option_ids = array_fill( 0, (int) $quantity, array() );
		if ( $single ) {
			$unit_option_ids[0] = $single;
		}

		return $unit_option_ids;
	}

	/**
	 * Load the activities chosen for each ticket from the event's activity
	 * catalogue. A selection naming an activity outside it is refused.
	 *
	 * @param int[][] $unit_option_ids      One list of option IDs per ticket.
	 * @param int     $config_event_date_id Event date the catalogue belongs to.
	 * @return array[]|WP_Error One list of TicketOption objects per ticket.
	 */
	private function load_unit_options( array $unit_option_ids, $config_event_date_id ) {
		if ( ! array_filter( $unit_option_ids ) ) {
			return array_fill( 0, count( $unit_option_ids ), array() );
		}

		$catalogue = array();
		foreach ( \FairEvents\Models\TicketOption::get_all_by_event_date_id( (int) $config_event_date_id ) as $option ) {
			$catalogue[ (int) $option->id ] = $option;
		}

		$unit_options = array();
		foreach ( $unit_option_ids as $option_ids ) {
			$options = array();
			foreach ( $option_ids as $option_id ) {
				if ( ! isset( $catalogue[ $option_id ] ) ) {
					return new WP_Error(
						'invalid_ticket_option',
						__( 'One of the selected activities is not available for this event.', 'fair-events' ),
						array( 'status' => 400 )
					);
				}
				$options[] = $catalogue[ $option_id ];
			}
			$unit_options[] = $options;
		}

		return $unit_options;
	}

	/**
	 * Build the payment line items for the activities chosen across the
	 * tickets of a purchase: one line per activity, charged once for every
	 * ticket that selected it, at the price resolved for this buyer. An
	 * activity priced at zero is free and gets no line; one without a price
	 * right now refuses the purchase rather than being given away.
	 *
	 * @param array[] $unit_options         One list of TicketOption objects per ticket.
	 * @param int     $config_event_date_id Event date the catalogue belongs to.
	 * @param string  $participant_token    Optional participant token sent with the request.
	 * @return array[]|WP_Error List of [ name, quantity, amount ].
	 */
	private function option_line_items( array $unit_options, $config_event_date_id, $participant_token ) {
		$options  = array();
		$selected = array();
		foreach ( $unit_options as $ticket_options ) {
			foreach ( $ticket_options as $option ) {
				$options[ (int) $option->id ]  = $option;
				$selected[ (int) $option->id ] = ( $selected[ (int) $option->id ] ?? 0 ) + 1;
			}
		}
		if ( ! $options ) {
			return array();
		}

		$base_prices = \FairEvents\Services\ActivityOptionPriceResolver::resolve_for_event_date( (int) $config_event_date_id )['price_by_option_id'];
		$prices      = \FairEvents\Services\ActivityOptionPriceResolver::charged_prices(
			array_intersect_key( $base_prices, $options ),
			(int) $config_event_date_id,
			$participant_token
		);

		$line_items = array();
		foreach ( $options as $option_id => $option ) {
			$price = $prices[ $option_id ] ?? null;
			if ( null === $price ) {
				return new WP_Error(
					'ticket_option_unavailable',
					sprintf(
						/* translators: %s: activity name */
						__( '"%s" is not currently on sale. Reload the page and choose again.', 'fair-events' ),
						$option->name
					),
					array( 'status' => 409 )
				);
			}
			if ( 0.0 === (float) $price ) {
				continue;
			}
			$line_items[] = array(
				'name'     => $option->name,
				'quantity' => $selected[ $option_id ],
				'amount'   => (float) $price,
			);
		}

		return $line_items;
	}

	/**
	 * Resolve request-time per-viewer personalization for the Event Signup
	 * block's cache-safe baseline render: restricted tiers becoming visible,
	 * discounted prices, name/email pre-fill, and signed-up state — none of
	 * which the base render (render.php) may compute, since a full-page
	 * cache stores and replays it (#1300). frontend.js hydrates this after
	 * load for every viewer, cached page or not, so the visible result never
	 * depends on who the page happened to be rendered for.
	 *
	 * Rebuilds the full (unfiltered, including group-restricted) ticket
	 * type/options/occurrences context render.php itself builds, runs it
	 * through the fair_events_signup_viewer_context filter (fair-audience's
	 * SignupHookBridge::enrich_render_context() is the intended consumer),
	 * and — only when that filter actually recognised a viewer — renders the
	 * two selection fieldsets and captures whatever the three render-slot
	 * actions echo, via output buffering, exactly as render.php fires them.
	 * An anonymous caller (the common case) does none of that rendering
	 * work: the response is an empty/no-op payload.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_viewer_context( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );

		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Pivot config/pricing lookups to the series master for generated
		// occurrences, mirroring render.php.
		$pricing_event_date_id = $event_date_id;
		if ( 'generated' === ( $event_date->occurrence_type ?? null ) && ! empty( $event_date->master_id ) ) {
			$pricing_event_date_id = (int) $event_date->master_id;
		}

		$ticket_types = array();
		if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( $pricing_event_date_id );
		}

		$series_master_id = null;
		if ( 'master' === ( $event_date->occurrence_type ?? null ) ) {
			$series_master_id = (int) $event_date->id;
		} elseif ( 'generated' === ( $event_date->occurrence_type ?? null ) && ! empty( $event_date->master_id ) ) {
			$series_master_id = (int) $event_date->master_id;
		}

		$occurrences_for_picker = array();
		if ( $series_master_id ) {
			$upcoming = \FairEvents\Models\EventDates::get_upcoming_by_master_id( $series_master_id );
			foreach ( $upcoming as $occ ) {
				$occurrences_for_picker[] = array(
					'id'             => (int) $occ->id,
					'start_datetime' => $occ->start_datetime,
					'end_datetime'   => $occ->end_datetime,
					'all_day'        => (bool) $occ->all_day,
					'signed_up'      => false,
				);
			}
		}

		$price_by_type_id   = array();
		$active_sale_period = null;
		$sale_period_count  = 0;
		if ( class_exists( \FairEvents\Services\TicketPricing::class ) ) {
			$resolved_prices    = \FairEvents\Services\TicketPricing::resolve_unit_prices_for_event_date( $pricing_event_date_id );
			$active_sale_period = $resolved_prices['active_period'];
			$sale_period_count  = $resolved_prices['sale_period_count'];
			$price_by_type_id   = $resolved_prices['price_by_type_id'];
		}

		// A ticket type with no explicit price row for the active sale period
		// isn't purchasable right now — drop it, mirroring render.php. Only a
		// stored zero price counts as free (issue #1624); with no active
		// period at all, nothing is purchasable. Runs before
		// SignupHookBridge::enrich_render_context() (hooked below) re-filters
		// for group restrictions, so sale-period and group-restriction
		// filtering compose correctly regardless of order.
		if ( class_exists( \FairEvents\Services\TicketPricing::class ) ) {
			$ticket_types = $active_sale_period
				? \FairEvents\Services\TicketPricing::filter_purchasable_types( $ticket_types, $price_by_type_id )
				: array();
		}

		// The same offered options, prices and availability render.php resolves.
		$ticket_options = \FairEvents\Services\ActivitySelection::offered_options( $pricing_event_date_id, $event_date_id );

		$minimum_activities = 0;
		if ( ! empty( $ticket_options ) && class_exists( \FairEvents\Models\EventDateSetting::class ) ) {
			$minimum_activities = (int) \FairEvents\Models\EventDateSetting::get( $pricing_event_date_id, 'minimum_activities' );
			$minimum_activities = max( 0, min( $minimum_activities, count( $ticket_options ) ) );
		}

		$show_ticket_price    = (bool) $request->get_param( 'show_ticket_price' );
		$show_option_prices   = (bool) $request->get_param( 'show_option_prices' );
		$payments_unavailable = ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured();

		/**
		 * Extension point for plugins (e.g. fair-audience) that resolve
		 * per-viewer personalization at request time. Safe to compute here —
		 * unlike fair_events_signup_render_context, this runs inside an
		 * uncached REST request, never inside the page a full-page cache
		 * stores. See REST_API_BACKEND.md.
		 *
		 * @param array $context Context array, the same shape
		 *                       fair_events_signup_render_context builds,
		 *                       plus 'viewer_resolved' (bool, default
		 *                       false) — a companion plugin sets this true
		 *                       whenever it recognises the viewer, signalling
		 *                       this endpoint to render the personalized
		 *                       fragments below.
		 */
		$context = apply_filters(
			'fair_events_signup_viewer_context',
			array(
				'event_date_id'            => $event_date_id,
				'pricing_event_date_id'    => $pricing_event_date_id,
				'ticket_types'             => $ticket_types,
				'price_by_type_id'         => $price_by_type_id,
				'active_sale_period'       => $active_sale_period,
				'sale_period_count'        => $sale_period_count,
				'occurrences_for_picker'   => $occurrences_for_picker,
				'ticket_options'           => $ticket_options,
				'minimum_activities'       => $minimum_activities,
				'prefill_name'             => '',
				'prefill_email'            => '',
				'suppress_form'            => false,
				'viewer_resolved'          => false,
				'participant_token'        => (string) $request->get_param( 'participant_token' ),
				'token_identity_validated' => false,
			)
		);

		$viewer_resolved = ! empty( $context['viewer_resolved'] );
		$suppress_form   = ! empty( $context['suppress_form'] );

		$occurrences_signed_up = array();
		foreach ( (array) ( $context['occurrences_for_picker'] ?? array() ) as $occ_row ) {
			if ( ! empty( $occ_row['signed_up'] ) ) {
				$occurrences_signed_up[] = (int) $occ_row['id'];
			}
		}

		$response = array(
			'viewer_resolved'              => $viewer_resolved,
			'token_identity_validated'     => ! empty( $context['token_identity_validated'] ),
			'suppress_form'                => $suppress_form,
			'ticket_type_fieldset_html'    => null,
			'ticket_options_fieldset_html' => null,
			'before_form_html'             => null,
			'before_submit_html'           => null,
			'after_form_html'              => null,
			'occurrences_signed_up'        => $occurrences_signed_up,
			'prefill_name'                 => (string) ( $context['prefill_name'] ?? '' ),
			'prefill_email'                => (string) ( $context['prefill_email'] ?? '' ),
		);

		// Anonymous majority case: no viewer was recognised, so there is
		// nothing to personalize — skip all rendering work below.
		if ( ! $viewer_resolved ) {
			return rest_ensure_response( $response );
		}

		// Deterministic and namespaced away from render.php's own
		// wp_unique_id()-based $form_id (a bare per-request counter) so IDs
		// generated by this separate REST request can never collide with the
		// IDs already present in the page's DOM.
		$form_id = 'fair-events-get-tickets-viewer-' . $event_date_id;

		if ( ! $suppress_form && ! empty( $context['ticket_types'] ) ) {
			$response['ticket_type_fieldset_html']    = \FairEvents\Services\SignupFieldsetRenderer::ticket_type_fieldset(
				$context['ticket_types'],
				$context['price_by_type_id'],
				$context['active_sale_period'],
				(int) $context['sale_period_count'],
				$show_ticket_price,
				$payments_unavailable,
				$form_id
			);
			$response['ticket_options_fieldset_html'] = \FairEvents\Services\SignupFieldsetRenderer::ticket_options_fieldset(
				$context['ticket_options'],
				$context['ticket_types'],
				$context['price_by_type_id'],
				(int) $context['minimum_activities'],
				$show_option_prices,
				$payments_unavailable,
				$form_id
			);

			ob_start();
			do_action( 'fair_events_signup_render_before_submit', $context );
			$response['before_submit_html'] = ob_get_clean();
		}

		// Fired regardless of suppress_form — inside the <form> when not
		// suppressed, inside the client-swapped companion wrapper otherwise,
		// mirroring render.php's two call sites for these same actions.
		ob_start();
		do_action( 'fair_events_signup_render_before_form', $context );
		$response['before_form_html'] = ob_get_clean();

		ob_start();
		do_action( 'fair_events_signup_render_after_form', $context );
		$response['after_form_html'] = ob_get_clean();

		return rest_ensure_response( $response );
	}

	/**
	 * Fire the sanctioned extension point for plugins (e.g. fair-audience)
	 * that want to attach viewer identity / participant records to a signup
	 * created through the base route, instead of owning a competing create
	 * route. See REST_API_BACKEND.md for the documented contract.
	 *
	 * @param int      $signup_id        The fair_events_signups row just created.
	 * @param int      $event_date_id    Event-date ID the signup targets.
	 * @param string   $name             Buyer name.
	 * @param string   $email            Buyer email.
	 * @param array    $ticket_selection Ticket selection: 'ticket_type_id', 'quantity',
	 *                                   'ticket_option_ids' (or 'event_date_ids' for
	 *                                   'multiple_instances' types), and 'mailing_opt_in'.
	 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
	 * @param string   $participant_token Optional companion credential.
	 * @return void
	 */
	private function fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id, $participant_token = '' ) {
		/**
		 * Fires after a signup row is persisted through the base create path.
		 *
		 * @param int      $signup_id        The fair_events_signups row just created.
		 * @param int      $event_date_id    Event-date ID the signup targets.
		 * @param string   $name             Buyer name.
		 * @param string   $email            Buyer email.
		 * @param array    $ticket_selection Ticket selection details.
		 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
		 * @param string   $participant_token Optional companion credential.
		 */
		do_action( 'fair_events_signup_created', $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id, $participant_token );
	}

	/**
	 * Ask a companion plugin which participant a purchase's transaction
	 * belongs to, before the transaction is created, so it is linked to the
	 * same participant the fair_events_signup_created listener will use
	 * rather than to whatever a general email lookup finds.
	 *
	 * @param int[]  $signup_ids        Signup rows the transaction pays for.
	 * @param string $email             Buyer email.
	 * @param string $participant_token Optional companion credential.
	 * @return int|null Participant ID, or null to let the payments connector resolve it.
	 */
	private function resolve_transaction_participant_id( array $signup_ids, $email, $participant_token = '' ) {
		/**
		 * Filters the participant a get-tickets transaction is created for.
		 *
		 * @param int|null $participant_id    Participant ID; null by default.
		 * @param int[]    $signup_ids        Signup rows the transaction pays for.
		 * @param string   $email             Buyer email.
		 * @param string   $participant_token Optional companion credential.
		 */
		$participant_id = apply_filters( 'fair_events_signup_transaction_participant_id', null, $signup_ids, $email, $participant_token );

		return $participant_id ? (int) $participant_id : null;
	}

	/**
	 * Fire the post-signup transaction hook, once every signup row a
	 * transaction pays for has been attached to it and had its
	 * fair_events_signup_created listeners run, and before payment is
	 * initiated. A companion plugin links the transaction to the
	 * participant its signups now carry.
	 *
	 * @param int   $transaction_id fair-payments-connector transaction ID.
	 * @param int[] $signup_ids     Signup rows the transaction pays for.
	 * @return void
	 */
	private function fire_signup_transaction_created( $transaction_id, array $signup_ids ) {
		/**
		 * Fires after a get-tickets transaction is attached to its signups.
		 *
		 * @param int   $transaction_id fair-payments-connector transaction ID.
		 * @param int[] $signup_ids     Signup rows the transaction pays for.
		 */
		do_action( 'fair_events_signup_transaction_created', $transaction_id, $signup_ids );
	}

	/**
	 * Parse and sanitize the custom question answers from a get-tickets
	 * request, mirroring fair-audience's EventSignupController. Validation
	 * runs before any signup mutation so bad input (e.g. a malformed phone
	 * number) is rejected with a 400 without creating a signup row.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array|WP_Error Sanitized answers, or WP_Error on invalid input.
	 */
	private function prepare_questionnaire_answers( $request ) {
		if ( ! class_exists( \FairForm\Services\QuestionnaireService::class ) ) {
			return array();
		}
		$service = new \FairForm\Services\QuestionnaireService();
		$answers = $service->parse_answers( $request->get_param( 'questionnaire_answers' ) );
		return $service->sanitize_answers( $answers );
	}

	/**
	 * Persist sanitized custom-question answers for a signup, called right
	 * after fire_signup_created() so the participant_id fair-audience's
	 * SignupHookBridge::link_participant() may have just set on the row is
	 * picked up; the submission stores null (anonymous) when fair-audience
	 * is inactive or the bridge left it unset. Nothing is persisted for
	 * signups without custom questions, avoiding empty submissions.
	 *
	 * The purchase's one answer set belongs to its first ticket (lowest
	 * position), looked up here from the signup just saved — never taken
	 * from the request — so a later purchase by the same participant gets
	 * its own submission instead of replacing this one's answers.
	 *
	 * @param int   $signup_id     The fair_events_signups row just created.
	 * @param int   $event_date_id Event-date ID the signup targets.
	 * @param array $answers       Sanitized answers from prepare_questionnaire_answers().
	 * @return void
	 */
	private function persist_questionnaire_answers( $signup_id, $event_date_id, $answers ) {
		if ( empty( $answers ) ) {
			return;
		}
		if ( ! class_exists( \FairForm\Services\QuestionnaireService::class ) ) {
			return;
		}

		$signup         = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
		$participant_id = $signup && $signup->participant_id ? (int) $signup->participant_id : null;

		$event_id = 0;
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date && ! empty( $event_date->event_id ) ) {
				$event_id = (int) $event_date->event_id;
			}
		}

		$service = new \FairForm\Services\QuestionnaireService();
		$service->save_answers(
			$participant_id,
			$answers,
			$event_date_id,
			$event_id,
			__( 'Event Signup', 'fair-events' ),
			true,
			'',
			'',
			$this->first_ticket_id( (int) $signup_id, (int) $event_date_id )
		);
	}

	/**
	 * First ticket (lowest position) of a signup, provided it is on the
	 * event date the answers are saved for.
	 *
	 * @param int $signup_id     Signup row ID.
	 * @param int $event_date_id Event date the answers are saved for.
	 * @return int Ticket ID, or 0 when the signup has no such ticket.
	 */
	private function first_ticket_id( $signup_id, $event_date_id ) {
		$tickets = \FairEvents\Models\EventTicket::get_by_signup_id( $signup_id );
		$first   = $tickets[0] ?? null;

		if ( ! $first || (int) $first->signup_id !== $signup_id || (int) $first->event_date_id !== $event_date_id ) {
			return 0;
		}

		return (int) $first->id;
	}

	/**
	 * Resolve the event post a purchase's transaction belongs to.
	 *
	 * Generated occurrences resolve through their series master, so a
	 * series purchase links to the series' own event. Dates without a
	 * linked post (standalone/external) return null and checkout proceeds
	 * without a post link.
	 *
	 * @param int $event_date_id Event-date ID the purchase targets.
	 * @return int|null Event post ID, or null if the date has no linked post.
	 */
	private function resolve_event_post_id( $event_date_id ) {
		if ( ! $event_date_id || ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return null;
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return null;
		}

		$post_id = (int) $event_date->get_resolved_event_id();

		return $post_id ? $post_id : null;
	}

	/**
	 * Resolve the page the buyer should return to after checkout.
	 *
	 * This runs inside a REST request, which carries no post context —
	 * get_permalink() is always false here, so it must never be used for the
	 * redirect. Prefer the page the purchase was made from (same-site referer,
	 * which also preserves ?event_date= on standalone pages), then the event's
	 * own page, then the homepage.
	 *
	 * @param int $event_date_id Event-date ID the purchase targets.
	 * @return string Absolute same-site URL.
	 */
	private function resolve_return_url( $event_date_id ) {
		$referer = wp_get_referer();
		if ( $referer ) {
			$validated = wp_validate_redirect( $referer, '' );
			if ( $validated ) {
				return $validated;
			}
		}

		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date && ! empty( $event_date->event_id ) ) {
				$permalink = get_permalink( (int) $event_date->event_id );
				if ( $permalink ) {
					return $permalink;
				}
			}
		}

		return home_url( '/' );
	}

	/**
	 * Create a ticket signup for a 'multiple_instances' ticket type: the buyer
	 * picks several specific occurrences of the series (instead of the single
	 * event_date_id the rest of create_signup() operates on) at a per-instance
	 * price, subject to the ticket type's configured minimum. Creates one
	 * EventSignup row per chosen occurrence, sharing a single transaction on
	 * the paid path so PaymentHooks confirms them together.
	 *
	 * @param WP_REST_Request               $request        Request object.
	 * @param \FairEvents\Models\TicketType $ticket_type    The 'multiple_instances' ticket type.
	 * @param int                           $series_page_id The event_date_id the request resolved to (the ticket type's own row).
	 * @param string                        $name           Buyer name.
	 * @param string                        $email          Buyer email.
	 * @param bool                          $mailing_opt_in Whether the buyer opted into mailings.
	 * @param string                        $idempotency_key Idempotency key of the checkout, or '' for none.
	 * @param string                        $fingerprint    Fingerprint of the purchase details, or '' without a key.
	 * @return WP_REST_Response|WP_Error
	 */
	private function create_multi_instance_signup( $request, $ticket_type, $series_page_id, $name, $email, $mailing_opt_in, $idempotency_key = '', $fingerprint = '' ) {
		$raw_ids = $request->get_param( 'event_date_ids' ) ?? array();
		$raw_ids = array_slice( array_values( array_unique( array_map( 'absint', (array) $raw_ids ) ) ), 0, 50 );
		$raw_ids = array_filter( $raw_ids );

		if ( empty( $raw_ids ) ) {
			return new WP_Error(
				'no_occurrences_selected',
				__( 'Please select at least one occurrence.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Resolve the series master from the page's own event date (the ticket
		// type's row) and validate every submitted ID belongs to that same
		// series — never trust the client list.
		$series_master_id = $this->resolve_master_event_date_id( $series_page_id );
		if ( ! $series_master_id ) {
			return new WP_Error(
				'invalid_ticket_type',
				__( 'Invalid ticket type.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$occurrences = array();
		foreach ( $raw_ids as $occ_id ) {
			$occ = \FairEvents\Models\EventDates::get_by_id( $occ_id );
			if ( ! $occ || $this->resolve_master_event_date_id( $occ_id ) !== $series_master_id ) {
				return new WP_Error(
					'invalid_occurrence',
					__( 'One of the selected occurrences is not valid for this ticket.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			$occurrences[] = $occ;
		}

		$minimum_instances = max( 1, (int) $ticket_type->minimum_instances );
		if ( count( $occurrences ) < $minimum_instances ) {
			return new WP_Error(
				'minimum_instances_not_met',
				sprintf(
					/* translators: %d: minimum number of occurrences required */
					_n(
						'Please select at least %d occurrence.',
						'Please select at least %d occurrences.',
						$minimum_instances,
						'fair-events'
					),
					$minimum_instances
				),
				array( 'status' => 400 )
			);
		}

		// Resolve the per-instance price from the active sale period (server-side; client amount is ignored).
		$unit_price        = \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type->id );
		$participant_token = (string) $request->get_param( 'participant_token' );
		$unit_price        = apply_filters( 'fair_events_signup_unit_price', $unit_price, (int) $ticket_type->id, (int) $series_page_id, $participant_token );
		if ( null === $unit_price ) {
			return new WP_Error(
				'ticket_type_unavailable',
				__( 'This ticket type is not currently on sale.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		$count        = count( $occurrences );
		$total_amount = $unit_price * $count;

		// Fail closed before any row is written: reject a priced multi-instance
		// signup when payment can't be collected, mirroring create_signup().
		if ( $total_amount > 0 && $this->payments_unavailable() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid tickets are not available because online payments are not configured.', 'fair-events' ),
				array( 'status' => 503 )
			);
		}

		$occurrence_ids   = array_map(
			function ( $occ ) {
				return (int) $occ->id;
			},
			$occurrences
		);
		$ticket_selection = array(
			'ticket_type_id' => (int) $ticket_type->id,
			'quantity'       => 1,
			'event_date_ids' => $occurrence_ids,
			'mailing_opt_in' => $mailing_opt_in,
		);

		// Paid path — payments were confirmed available above (see the
		// fail-closed guard), so one shared payment for every occurrence is
		// planned here and carried out once the signup rows are saved.
		$payment = null;
		if ( $total_amount > 0 ) {
			$series_master = \FairEvents\Models\EventDates::get_by_id( $series_master_id );
			$event_title   = $series_master ? $this->resolve_event_title( $series_master ) : null;
			$description   = $event_title
				? sprintf(
					/* translators: %s: event name */
					__( 'Tickets for %s', 'fair-events' ),
					$event_title
				)
				: sprintf(
					/* translators: %d: event date ID */
					__( 'Tickets for event #%d', 'fair-events' ),
					$series_master_id
				);

			$line_items = array();
			foreach ( $occurrences as $occ ) {
				$occ_label    = class_exists( \FairEvents\Helpers\DateRangeFormatter::class )
					? \FairEvents\Helpers\DateRangeFormatter::format( $occ->start_datetime, $occ->end_datetime, (bool) $occ->all_day )
					: $occ->start_datetime;
				$line_items[] = array(
					'name'     => sprintf(
						/* translators: %s: occurrence date/time label */
						__( 'Ticket for %s', 'fair-events' ),
						$occ_label
					),
					'quantity' => 1,
					'amount'   => $unit_price,
				);
			}

			$payment = array(
				'line_items'    => $line_items,
				'description'   => $description,
				'currency'      => Money::site_currency(),
				'event_date_id' => (int) $series_master_id,
			);
		}

		// Persist one signup row per chosen occurrence (quantity fixed at 1;
		// instance count is the only multiplier for this scope). Every row is
		// checked and written in one locked transaction: each occurrence
		// needs a place, and the ticket type needs one per occurrence.
		$demands = array();
		foreach ( $occurrences as $occ ) {
			$demands[] = array(
				'event_date_id'  => (int) $occ->id,
				'ticket_type_id' => (int) $ticket_type->id,
				'quantity'       => 1,
			);
		}

		$checkout = $this->reserve_checkout(
			$idempotency_key,
			$fingerprint,
			array(
				'ticket_selection' => $ticket_selection,
				'amount'           => $total_amount,
				'payment'          => $payment,
				// One key and one transaction pay for every occurrence's row.
				'shared'           => true,
			),
			$demands,
			static function () use ( $occurrences, $ticket_type, $name, $email, $mailing_opt_in, $unit_price, $total_amount ) {
				$saved_ids = array();
				foreach ( $occurrences as $occ ) {
					$signup_id = \FairEvents\Models\EventSignup::save_in_transaction(
						array(
							'event_date_id'  => (int) $occ->id,
							'ticket_type_id' => $ticket_type->id,
							'name'           => $name,
							'email'          => $email,
							'quantity'       => 1,
							'mailing_opt_in' => $mailing_opt_in ? 1 : 0,
							'amount'         => $unit_price,
							'status'         => $total_amount > 0 ? 'pending_payment' : 'confirmed',
						)
					);
					if ( ! $signup_id ) {
						return false;
					}
					$saved_ids[] = (int) $signup_id;
				}
				return $saved_ids;
			}
		);

		if ( is_wp_error( $checkout ) ) {
			return $checkout;
		}

		if ( isset( $checkout['replay'] ) ) {
			return $this->replay_checkout( $request, $checkout['replay'], $fingerprint );
		}

		return $this->finish_checkout( $request, $checkout );
	}

	/**
	 * Whether online payments can be collected right now.
	 *
	 * True when the payments connector is missing entirely, or installed but
	 * not configured (no Mollie key / OAuth). Priced signups are rejected up
	 * front in that case instead of being saved and then failing at payment
	 * time, so no orphaned pending_payment rows are created and no priced
	 * ticket is ever confirmed for free.
	 *
	 * @return bool
	 */
	private function payments_unavailable() {
		return ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured();
	}

	/**
	 * Resolve the recurring-series master event_date_id for a given event
	 * date row: itself when it's already the master, or its master_id when
	 * it's a generated occurrence. Null when the row isn't part of a series.
	 *
	 * @param int $event_date_id Event-date ID (master or generated occurrence).
	 * @return int|null Master event_date_id, or null when not resolvable.
	 */
	private function resolve_master_event_date_id( $event_date_id ) {
		if ( ! $event_date_id || ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return null;
		}
		$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $ed ) {
			return null;
		}
		if ( 'generated' === $ed->occurrence_type && $ed->master_id ) {
			return (int) $ed->master_id;
		}
		if ( 'master' === $ed->occurrence_type ) {
			return (int) $ed->id;
		}
		return null;
	}

	/**
	 * Resolve the human-readable event title for a transaction description,
	 * mirroring EmailService::send_signup_confirmation()'s title lookup.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event date row.
	 * @return string|null Event post title, or null when no post can be
	 *                      resolved (e.g. an external-URL event date), letting
	 *                      the caller fall back to the numeric #<id> format.
	 */
	private function resolve_event_title( \FairEvents\Models\EventDates $event_date ) {
		$event = get_post( $event_date->get_resolved_event_id() );
		return $event ? $event->post_title : null;
	}

	/**
	 * Get signups for an event date (admin).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$event_date_id = $request->get_param( 'event_date' );
		$signups       = \FairEvents\Models\EventSignup::get_all_by_event_date_id( $event_date_id );

		$ticket_type_names  = array();
		$ticket_type_scopes = array();
		if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( $event_date_id );

			// A 'whole_series'/'multiple_instances' ticket type is configured
			// on the series master, not the occurrence a signup was made
			// against (see create_signup()'s $config_event_date_id pivot
			// above) — pull those in too so a child-occurrence signup still
			// resolves the name instead of falling back to null.
			$master_event_date_id = $this->resolve_master_event_date_id( $event_date_id );
			if ( $master_event_date_id && (int) $master_event_date_id !== (int) $event_date_id ) {
				$ticket_types = array_merge(
					$ticket_types,
					\FairEvents\Models\TicketType::get_all_by_event_date_id( $master_event_date_id )
				);
			}

			foreach ( $ticket_types as $ticket_type ) {
				$ticket_type_names[ (int) $ticket_type->id ]  = $ticket_type->name;
				$ticket_type_scopes[ (int) $ticket_type->id ] = $ticket_type->recurrence_scope;
			}
		}

		// Whether this date has other active occurrences a signup can move to.
		$master_event_date_id = $this->resolve_master_event_date_id( $event_date_id );
		$active_dates         = $master_event_date_id
			? array_filter(
				\FairEvents\Models\EventDates::get_all_by_master_id( $master_event_date_id ),
				static function ( $event_date ) {
					return 'active' === $event_date->status;
				}
			)
			: array();
		$is_series            = count( $active_dates ) > 1;

		$overrides         = \FairEvents\Models\EventCapacityOverride::get_by_signup_ids( wp_list_pluck( $signups, 'id' ) );
		$tickets_by_signup = \FairEvents\Models\EventTicket::get_by_signup_ids( wp_list_pluck( $signups, 'id' ) );
		$ticket_activities = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids(
			array_map( static fn( $ticket ) => (int) $ticket->id, array_merge( array(), ...array_values( $tickets_by_signup ) ) )
		);
		$user_names        = array();

		foreach ( $signups as $signup ) {
			$signup->ticket_type_name = $signup->ticket_type_id && isset( $ticket_type_names[ (int) $signup->ticket_type_id ] )
				? $ticket_type_names[ (int) $signup->ticket_type_id ]
				: null;
			$signup->mailing_opt_in   = true === $signup->mailing_opt_in
				|| 1 === $signup->mailing_opt_in
				|| '1' === $signup->mailing_opt_in;
			$signup->over_capacity    = true === $signup->over_capacity
				|| 1 === $signup->over_capacity
				|| '1' === $signup->over_capacity;
			$signup->recurrence_scope = $signup->ticket_type_id && isset( $ticket_type_scopes[ (int) $signup->ticket_type_id ] )
				? $ticket_type_scopes[ (int) $signup->ticket_type_id ]
				: null;
			$signup->can_move         = $is_series && 'whole_series' !== $signup->recurrence_scope;
			$signup->overrides        = array_map(
				static function ( $override ) use ( &$user_names ) {
					$user_id = (int) $override->user_id;
					if ( ! array_key_exists( $user_id, $user_names ) ) {
						$user                   = $user_id ? get_userdata( $user_id ) : false;
						$user_names[ $user_id ] = $user ? $user->display_name : null;
					}
					return array(
						'action'            => $override->action,
						'activity_name'     => (string) ( $override->ticket_option_name ?? '' ),
						'reason'            => $override->reason,
						'user_display_name' => $user_names[ $user_id ],
						'created_at'        => $override->created_at,
					);
				},
				$overrides[ (int) $signup->id ] ?? array()
			);
			// Each ticket's own type is authoritative: an administrator may
			// have given one ticket of the purchase another type.
			$signup->tickets = array_map(
				static function ( $ticket ) use ( $ticket_type_names, $ticket_activities ) {
					$activity_ids           = array();
					$confirmed_activity_ids = array();
					foreach ( $ticket_activities[ (int) $ticket->id ] ?? array() as $row ) {
						if ( \FairEvents\Models\EventTicketActivity::is_active_row( $row ) ) {
							$activity_ids[] = (int) $row->ticket_option_id;
						}
						// Paid-for extras only: an activity counts once both it and
						// its ticket are confirmed, as on the Audience tab.
						if ( 'confirmed' === $row->status && 'confirmed' === (string) $ticket->status ) {
							$confirmed_activity_ids[] = (int) $row->ticket_option_id;
						}
					}
					return array(
						'id'                     => (int) $ticket->id,
						'position'               => (int) $ticket->unit_position,
						'reference'              => strtoupper( substr( (string) $ticket->reference, 0, 8 ) ),
						'ticket_type_id'         => $ticket->ticket_type_id ? (int) $ticket->ticket_type_id : null,
						'ticket_type_name'       => $ticket->ticket_type_id ? ( $ticket_type_names[ (int) $ticket->ticket_type_id ] ?? null ) : null,
						'status'                 => (string) $ticket->status,
						'attended_at'            => $ticket->attended_at,
						'activity_ids'           => $activity_ids,
						'confirmed_activity_ids' => $confirmed_activity_ids,
					);
				},
				$tickets_by_signup[ (int) $signup->id ] ?? array()
			);
		}

		if ( $request->get_param( 'include_answers' ) ) {
			$this->attach_signup_answers( $signups, $event_date_id );
		}

		return rest_ensure_response( $signups );
	}

	/**
	 * Attach Fair Form answers to each signup row, in place, for the
	 * "include_answers" export flow.
	 *
	 * Each ticket in `tickets` gains `answers` (empty when none is attached
	 * to it) and `answers_need_review`. The signup's own `answers` repeat the
	 * first of its tickets that has any, naming that ticket in
	 * `answers_ticket_id`. A signup whose tickets hold no answers falls back
	 * to its participant's signup answers not attached to any ticket
	 * (collected without one, or whose ticket was removed), with
	 * `answers_ticket_id` null. Standalone Fair Form block submissions are
	 * never included.
	 *
	 * Leaves `answers` unset when fair-form isn't active, so the frontend can
	 * treat "no answers anywhere" and "plugin inactive" the same way.
	 *
	 * @param array $signups       Signup rows from get_all_by_event_date_id(), mutated in place.
	 * @param int   $event_date_id Event-date ID the signups belong to.
	 * @return void
	 */
	private function attach_signup_answers( $signups, $event_date_id ) {
		if ( ! class_exists( \FairForm\Services\TicketAnswers::class ) ) {
			$this->attach_participant_signup_answers( $signups, $event_date_id );
			return;
		}

		$ticket_ids = array();
		foreach ( $signups as $signup ) {
			foreach ( $signup->tickets ?? array() as $ticket ) {
				$ticket_ids[] = (int) $ticket['id'];
			}
		}

		$by_ticket      = \FairForm\Services\TicketAnswers::for_tickets( $ticket_ids );
		$by_participant = \FairForm\Services\TicketAnswers::participant_scope_for_event_date( $event_date_id );

		foreach ( $signups as $signup ) {
			$signup->answers             = array();
			$signup->answers_ticket_id   = null;
			$signup->answers_need_review = false;
			$tickets                     = $signup->tickets ?? array();
			foreach ( $tickets as $index => $ticket ) {
				$entry = $by_ticket[ (int) $ticket['id'] ] ?? null;

				$tickets[ $index ]['answers']             = $entry ? $entry['answers'] : array();
				$tickets[ $index ]['answers_need_review'] = $entry ? $entry['needs_review'] : false;

				if ( $entry && null === $signup->answers_ticket_id ) {
					$signup->answers             = $entry['answers'];
					$signup->answers_ticket_id   = (int) $ticket['id'];
					$signup->answers_need_review = $entry['needs_review'];
				}
			}
			$signup->tickets = $tickets;

			$participant_id = ! empty( $signup->participant_id ) ? (int) $signup->participant_id : 0;
			if ( null === $signup->answers_ticket_id && $participant_id && isset( $by_participant[ $participant_id ] ) ) {
				$signup->answers             = $by_participant[ $participant_id ]['answers'];
				$signup->answers_need_review = $by_participant[ $participant_id ]['needs_review'];
			}
		}
	}

	/**
	 * Attach answers by participant and event date, for a fair-form version
	 * that does not record tickets yet: the signup-origin submission (empty
	 * form_id) of the signup's participant, newest first. Leaves `answers`
	 * unset when fair-form isn't active.
	 *
	 * @param array $signups       Signup rows, mutated in place.
	 * @param int   $event_date_id Event-date ID the signups belong to.
	 * @return void
	 */
	private function attach_participant_signup_answers( $signups, $event_date_id ) {
		if ( ! class_exists( \FairForm\Database\QuestionnaireSubmissionRepository::class )
			|| ! class_exists( \FairForm\Database\QuestionnaireAnswerRepository::class ) ) {
			return;
		}

		$submission_repo = new \FairForm\Database\QuestionnaireSubmissionRepository();
		$answer_repo     = new \FairForm\Database\QuestionnaireAnswerRepository();

		$submissions = $submission_repo->get_by_filters( array( 'event_date_id' => $event_date_id ) );

		// Signup-origin submissions only (empty form_id); indexed by
		// participant_id, first-wins — get_by_filters() already orders by
		// created_at DESC, so the latest submission survives.
		$submission_by_participant = array();
		foreach ( $submissions as $submission ) {
			if ( ! empty( $submission->form_id ) ) {
				continue;
			}
			$participant_id = (int) $submission->participant_id;
			if ( ! $participant_id || isset( $submission_by_participant[ $participant_id ] ) ) {
				continue;
			}
			$submission_by_participant[ $participant_id ] = $submission;
		}

		foreach ( $signups as $signup ) {
			$participant_id = ! empty( $signup->participant_id ) ? (int) $signup->participant_id : 0;
			$submission     = $participant_id && isset( $submission_by_participant[ $participant_id ] )
				? $submission_by_participant[ $participant_id ]
				: null;

			if ( ! $submission ) {
				$signup->answers = array();
				continue;
			}

			$answers         = $answer_repo->get_by_submission( $submission->id );
			$signup->answers = array_map( array( $this, 'format_signup_answer' ), $answers );
		}
	}

	/**
	 * Format one Fair Form answer for the signup export response, matching
	 * QuestionnaireResponsesController's shape (question_key, question_text,
	 * question_type, answer_value, plus file_url/is_image for file_upload).
	 *
	 * @param \FairForm\Models\QuestionnaireAnswer $answer Answer model.
	 * @return array
	 */
	private function format_signup_answer( $answer ) {
		$answer_item = array(
			'question_key'  => $answer->question_key,
			'question_text' => $answer->question_text,
			'question_type' => $answer->question_type,
			'answer_value'  => $answer->answer_value,
		);

		if ( 'file_upload' === $answer->question_type && is_numeric( $answer->answer_value ) ) {
			$attachment_id  = (int) $answer->answer_value;
			$attachment_url = wp_get_attachment_url( $attachment_id );
			if ( $attachment_url ) {
				$answer_item['file_url'] = $attachment_url;
				$mime                    = get_post_mime_type( $attachment_id );
				$answer_item['is_image'] = $mime && 0 === strpos( $mime, 'image/' );
			}
		}

		return $answer_item;
	}

	/**
	 * Delete one signup by its exact row ID (admin).
	 *
	 * This removes only the local signup. It intentionally does not touch a
	 * companion participant record or payment-provider transaction.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$signup = \FairEvents\Models\EventSignup::get_by_id( $id );

		if ( ! $signup ) {
			return new WP_Error(
				'rest_signup_not_found',
				__( 'Signup not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! \FairEvents\Models\EventSignup::delete( $id ) ) {
			return new WP_Error(
				'rest_signup_delete_failed',
				__( 'Failed to delete signup.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'signup'  => $signup,
			),
			200
		);
	}

	/**
	 * Move a signup to another occurrence of its series, or give it another
	 * ticket type (admin). The signup and every unit not cancelled or
	 * refunded on its own change together, under the capacity lock. Going
	 * past a limit needs an override reason; the edit is then flagged over
	 * capacity and recorded in the override audit table.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$signup = \FairEvents\Models\EventSignup::get_by_id( $id );

		if ( ! $signup ) {
			return new WP_Error(
				'rest_signup_not_found',
				__( 'Signup not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( 'confirmed' !== $signup->status ) {
			return $this->signup_not_editable_error();
		}

		$target_event_date_id  = (int) $request->get_param( 'event_date_id' );
		$target_ticket_type_id = (int) $request->get_param( 'ticket_type_id' );

		if ( ( $target_event_date_id > 0 ) === ( $target_ticket_type_id > 0 ) ) {
			return new WP_Error(
				'rest_invalid_signup_edit',
				__( 'Choose either a new date or a new ticket type.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$reason = null;
		if ( $request->has_param( 'override_reason' ) ) {
			$reason = trim( (string) $request->get_param( 'override_reason' ) );
			if ( '' === $reason ) {
				return new WP_Error(
					'override_reason_required',
					__( 'Enter a reason for going over capacity.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( $target_event_date_id ) {
			$action  = 'move';
			$scope   = 'event_date';
			$target  = $target_event_date_id;
			$current = (int) $signup->event_date_id;
			$valid   = $this->get_move_targets( $signup );
		} else {
			$action  = 'change_type';
			$scope   = 'ticket_type';
			$target  = $target_ticket_type_id;
			$current = (int) $signup->ticket_type_id;
			$valid   = $this->get_ticket_type_targets( $signup );
		}

		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		if ( $target !== $current && ! in_array( $target, array_map( 'intval', wp_list_pluck( $valid, 'id' ) ), true ) ) {
			return new WP_Error(
				'rest_invalid_signup_target',
				'move' === $action
					? __( 'The chosen date is not another active date of this series.', 'fair-events' )
					: __( 'The chosen ticket type is not available for this signup.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// A ticket type allows its own activities, so a type change must
		// keep every ticket's selection within the new type's rules.
		if ( 'change_type' === $action && $target !== $current ) {
			if ( \FairEvents\Models\EventTicket::has_individual_types( $signup ) ) {
				return self::individual_types_error();
			}

			$rule_error = $this->ticket_type_activity_error( \FairEvents\Models\TicketType::get_by_id( $target ), $id );
			if ( $rule_error ) {
				return $rule_error;
			}
		}

		// Lock the target row only: a move changes no ticket type, and a
		// type change no date. A move also takes the tickets' activities to
		// the target date, where they need places of their own.
		$demand = 'move' === $action
			? array(
				'event_date_id'  => $target,
				'ticket_type_id' => 0,
				'quantity'       => 1,
				'option_ids'     => $target !== $current ? $this->active_signup_option_ids( $id ) : array(),
			)
			: array(
				'event_date_id'  => 0,
				'ticket_type_id' => $target,
				'quantity'       => 1,
			);

		$result = \FairEvents\Services\TicketCapacity::with_capacity_lock(
			array( $demand ),
			static function () use ( $id, $action, $scope, $target, $reason, $demand ) {
				$signup = \FairEvents\Models\EventSignup::get_by_id( $id );
				if ( ! $signup || 'confirmed' !== $signup->status ) {
					return new WP_Error(
						'signup_not_editable',
						__( 'Only confirmed signups can be moved or given another ticket type.', 'fair-events' ),
						array( 'status' => 409 )
					);
				}

				$failed = new WP_Error(
					'rest_signup_update_failed',
					__( 'Failed to update signup.', 'fair-events' ),
					array( 'status' => 500 )
				);

				// Checked again under the lock: a ticket may have been
				// given its own type since the check above.
				if ( 'change_type' === $action && \FairEvents\Models\EventTicket::has_individual_types( $signup ) ) {
					return self::individual_types_error();
				}

				if ( false === \FairEvents\Models\EventTicket::reconcile_signup( $signup ) ) {
					return $failed;
				}

				// A move takes along the tickets still on the signup's date,
				// and joins any the signup already has on the target; a
				// ticket moved on its own to a third date stays there.
				if ( 'move' === $action ) {
					$ticket_count = \FairEvents\Models\EventTicket::count_active_units( $id, (int) $signup->event_date_id );
					if ( $target !== (int) $signup->event_date_id ) {
						$ticket_count += \FairEvents\Models\EventTicket::count_active_units( $id, $target );
					}
				} else {
					$ticket_count = \FairEvents\Models\EventTicket::count_active_units( $id );
				}
				$projection = \FairEvents\Services\TicketCapacity::projection( $scope, $target, $ticket_count, $id );
				if ( ! $projection ) {
					return $failed;
				}

				$exceeding = \FairEvents\Services\TicketCapacity::projection_exceeds( $projection ) ? array( $projection ) : array();
				if ( 'move' === $action && ! empty( $demand['option_ids'] ) ) {
					$demand['quantity'] = 0;
					foreach ( \FairEvents\Services\TicketCapacity::activity_projections( array( $demand ) ) as $activity_projection ) {
						if ( \FairEvents\Services\TicketCapacity::projection_exceeds( $activity_projection ) ) {
							$exceeding[] = $activity_projection;
						}
					}
				}

				$over = (bool) $exceeding;
				if ( $over && null === $reason ) {
					return new WP_Error(
						'capacity_exceeded',
						sprintf(
							/* translators: 1: event date, ticket type or activity name, 2: places taken after the change, 3: capacity */
							_n(
								'%1$s would have %2$d of %3$d place taken.',
								'%1$s would have %2$d of %3$d places taken.',
								(int) $exceeding[0]['capacity'],
								'fair-events'
							),
							$exceeding[0]['label'],
							$exceeding[0]['after'],
							$exceeding[0]['capacity']
						),
						array(
							'status'      => 409,
							'projection'  => $exceeding[0],
							'projections' => $exceeding,
						)
					);
				}

				$applied = 'move' === $action
					? \FairEvents\Models\EventSignup::move_in_transaction( $id, $target )
					: \FairEvents\Models\EventSignup::change_ticket_type_in_transaction( $id, $target );
				if ( ! $applied ) {
					return $failed;
				}

				if ( $over ) {
					\FairEvents\Models\EventSignup::mark_over_capacity( $id );

					$tickets = \FairEvents\Models\EventTicket::get_by_signup_id( $id );
					foreach ( $exceeding as $exceeded ) {
						$is_activity = 'ticket_option' === $exceeded['scope'];
						$recorded    = \FairEvents\Models\EventCapacityOverride::create(
							array(
								'signup_id'           => $id,
								'action'              => $action,
								'from_event_date_id'  => (int) $signup->event_date_id,
								'to_event_date_id'    => 'move' === $action ? $target : (int) $signup->event_date_id,
								'from_ticket_type_id' => (int) $signup->ticket_type_id,
								'to_ticket_type_id'   => 'move' === $action ? (int) $signup->ticket_type_id : $target,
								'ticket_option_id'    => $is_activity ? (int) $exceeded['id'] : 0,
								'ticket_option_name'  => $is_activity ? $exceeded['label'] : '',
								'ticket_count'        => $is_activity ? (int) $exceeded['after'] - (int) $exceeded['taken'] : $ticket_count,
								'taken'               => $exceeded['taken'],
								'capacity'            => (int) $exceeded['capacity'],
								'reason'              => $reason,
								'user_id'             => get_current_user_id(),
							)
						);
						if ( ! $recorded ) {
							return $failed;
						}

						if ( $is_activity ) {
							foreach ( $tickets as $ticket ) {
								\FairEvents\Models\EventTicketActivity::mark_over_capacity( (int) $ticket->id, array( (int) $exceeded['id'] ) );
							}
						}
					}
				}

				return array(
					'projection'    => $projection,
					'over_capacity' => $over,
				);
			}
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$updated = \FairEvents\Models\EventSignup::get_by_id( $id );

		if ( $target !== $current ) {
			if ( 'move' === $action ) {
				/**
				 * Fires after an administrator moved a signup and its ticket
				 * units to another occurrence of the series.
				 *
				 * @param object $signup             The signup row after the move.
				 * @param int    $from_event_date_id Event date the signup was on.
				 */
				do_action( 'fair_events_signup_moved', $updated, $current );
			} else {
				/**
				 * Fires after an administrator gave a signup and its ticket
				 * units another ticket type.
				 *
				 * @param object $signup              The signup row after the change.
				 * @param int    $from_ticket_type_id Ticket type the signup had.
				 */
				do_action( 'fair_events_signup_ticket_type_changed', $updated, $current );
			}
		}

		return new WP_REST_Response(
			array(
				'signup'        => $updated,
				'projection'    => $result['projection'],
				'over_capacity' => $result['over_capacity'],
			),
			200
		);
	}

	/**
	 * The activities held by the tickets a signup's move takes along: those
	 * on the signup's own date and not cancelled or refunded on their own.
	 * One entry per ticket and activity.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return int[]
	 */
	private function active_signup_option_ids( $signup_id ) {
		$signup     = \FairEvents\Models\EventSignup::get_by_id( (int) $signup_id );
		$option_ids = array();
		foreach ( \FairEvents\Services\TicketCapacity::demands_for_signup( $signup ) as $demand ) {
			if ( (int) $demand['event_date_id'] === (int) $signup->event_date_id ) {
				$option_ids = array_merge( $option_ids, $demand['option_ids'] );
			}
		}

		return $option_ids;
	}

	/**
	 * Check that every ticket of a signup keeps an activity selection the
	 * given ticket type allows: activities enabled at all, and the number
	 * selected within its minimum and maximum.
	 *
	 * @param \FairEvents\Models\TicketType|null $ticket_type Target ticket type.
	 * @param int                                $signup_id   Signup row ID.
	 * @return WP_Error|null
	 */
	private function ticket_type_activity_error( $ticket_type, $signup_id ) {
		if ( ! $ticket_type ) {
			return null;
		}

		$tickets = array_filter(
			\FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup_id ),
			static function ( $ticket ) {
				return ! in_array( (string) $ticket->status, \FairEvents\Models\EventTicket::FINAL_UNIT_STATUSES, true );
			}
		);

		foreach ( $tickets as $ticket ) {
			$error = \FairEvents\Services\TicketEditRules::activity_count_error(
				$ticket_type,
				count( \FairEvents\Models\EventTicketActivity::get_active_option_ids( array( (int) $ticket->id ) ) )
			);
			if ( $error ) {
				return $error;
			}
		}

		return null;
	}

	/**
	 * List where a signup can be moved and which ticket types it can take,
	 * with the places left on each (admin).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_edit_targets( $request ) {
		$signup = \FairEvents\Models\EventSignup::get_by_id( (int) $request->get_param( 'id' ) );

		if ( ! $signup ) {
			return new WP_Error(
				'rest_signup_not_found',
				__( 'Signup not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$event_dates = $this->get_move_targets( $signup );
		$ticket_type = $this->get_ticket_type_targets( $signup );

		return rest_ensure_response(
			array(
				'event_dates'  => is_wp_error( $event_dates ) ? array() : array_map(
					static function ( $event_date ) {
						return array(
							'id'        => (int) $event_date->id,
							'label'     => \FairEvents\Helpers\DateRangeFormatter::format( $event_date->start_datetime, $event_date->end_datetime, (bool) $event_date->all_day ),
							'capacity'  => $event_date->capacity,
							'remaining' => \FairEvents\Services\TicketCapacity::remaining_for_event_date( (int) $event_date->id ),
						);
					},
					$event_dates
				),
				'ticket_types' => is_wp_error( $ticket_type ) ? array() : array_map(
					static function ( $type ) {
						return array(
							'id'        => (int) $type->id,
							'label'     => $type->name,
							'capacity'  => $type->capacity,
							'remaining' => \FairEvents\Services\TicketCapacity::remaining_for_ticket_type( (int) $type->id ),
						);
					},
					$ticket_type
				),
			)
		);
	}

	/**
	 * Error for a signup-wide type change on a purchase whose tickets were
	 * given their own types: it would silently overwrite them.
	 *
	 * @return WP_Error
	 */
	private static function individual_types_error() {
		return new WP_Error(
			'ticket_types_individually_edited',
			__( 'Tickets in this purchase have been given their own types. Edit each ticket instead.', 'fair-events' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * Error for a signup that is not confirmed.
	 *
	 * @return WP_Error
	 */
	private function signup_not_editable_error() {
		return new WP_Error(
			'signup_not_editable',
			__( 'Only confirmed signups can be moved or given another ticket type.', 'fair-events' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * The other active occurrences of a signup's series, which it can be
	 * moved to. A whole-series ticket already covers every occurrence and
	 * cannot be moved.
	 *
	 * @param object $signup Signup row.
	 * @return \FairEvents\Models\EventDates[]|WP_Error
	 */
	private function get_move_targets( $signup ) {
		if ( $signup->ticket_type_id ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $signup->ticket_type_id );
			if ( $ticket_type && $ticket_type->is_whole_series() ) {
				return new WP_Error(
					'signup_not_movable',
					__( 'A whole-series ticket covers every date and cannot be moved.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		$master_id = $this->resolve_master_event_date_id( (int) $signup->event_date_id );
		$siblings  = $master_id
			? array_filter(
				array_values( \FairEvents\Models\EventDates::get_all_by_master_id( $master_id ) ),
				static function ( $event_date ) {
					return 'active' === $event_date->status;
				}
			)
			: array();

		if ( count( $siblings ) < 2 ) {
			return new WP_Error(
				'signup_not_movable',
				__( 'This event has no other dates to move the signup to.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		return array_values(
			array_filter(
				$siblings,
				static function ( $event_date ) use ( $signup ) {
					return (int) $event_date->id !== (int) $signup->event_date_id;
				}
			)
		);
	}

	/**
	 * The other ticket types a signup can take: enabled types of the same
	 * event or its series master, with the same recurrence scope as its
	 * current type.
	 *
	 * @param object $signup Signup row.
	 * @return \FairEvents\Models\TicketType[]|WP_Error
	 */
	private function get_ticket_type_targets( $signup ) {
		$current = $signup->ticket_type_id
			? \FairEvents\Models\TicketType::get_by_id( (int) $signup->ticket_type_id )
			: null;

		if ( ! $current ) {
			return new WP_Error(
				'signup_has_no_ticket_type',
				__( 'This signup has no ticket type to change.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		return \FairEvents\Services\TicketEditRules::ticket_type_targets( (int) $signup->event_date_id, $current );
	}

	/**
	 * Admin permissions check.
	 *
	 * @return bool
	 */
	public function admin_permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission check shared by payment-state / retry-payment /
	 * cancel-payment: the visitor must own the transaction. Returns a 404 on
	 * any failure so an anonymous caller cannot enumerate transaction IDs by
	 * distinguishing missing rows from token mismatches, matching
	 * PaymentEndpoint::get_transaction_status_permissions_check().
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function signup_payment_permissions_check( $request ) {
		if ( null !== $this->resolve_transaction_from_request( $request ) ) {
			return true;
		}

		return new WP_Error(
			'transaction_not_found',
			__( 'Transaction not found.', 'fair-events' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Resolve the transaction a request is authorized to act on.
	 *
	 * Allowed (in order): a `transaction_id` + `token` matching the
	 * transaction's access_token (hash_equals); the transaction's owning
	 * logged-in user; or — the direct-navigation case, no explicit
	 * transaction_id/token at all, or a token that failed to match — the
	 * SignupPaymentSession cookie, provided it resolves to the same
	 * transaction_id (when one was supplied) and its signup row is still
	 * within its payment hold window.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return object|null Transaction object, or null when unauthorized.
	 */
	private function resolve_transaction_from_request( $request ) {
		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
			return null;
		}

		$transaction_id = (int) $request->get_param( 'transaction_id' );
		$token          = (string) $request->get_param( 'token' );

		if ( $transaction_id <= 0 ) {
			return $this->resolve_transaction_from_cookie( null );
		}

		$transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $transaction_id );
		if ( ! $transaction ) {
			return null;
		}

		$expected_token = (string) ( $transaction->access_token ?? '' );
		if ( '' !== $token && '' !== $expected_token && hash_equals( $expected_token, $token ) ) {
			return $transaction;
		}

		$user_id = get_current_user_id();
		if ( $user_id && ! empty( $transaction->user_id ) && (int) $transaction->user_id === $user_id ) {
			return $transaction;
		}

		return $this->resolve_transaction_from_cookie( $transaction_id );
	}

	/**
	 * Resolve a transaction from the SignupPaymentSession cookie, optionally
	 * constrained to a specific transaction_id (so a stale/foreign cookie
	 * can't ride along on someone else's transaction reference).
	 *
	 * @param int|null $expected_transaction_id Required transaction_id match, or null to accept any.
	 * @return object|null Transaction object, or null when the cookie is absent/invalid/expired.
	 */
	private function resolve_transaction_from_cookie( $expected_transaction_id ) {
		$session = \FairEvents\Services\SignupPaymentSession::get();
		if ( ! $session ) {
			return null;
		}
		if ( null !== $expected_transaction_id && $session['transaction_id'] !== (int) $expected_transaction_id ) {
			return null;
		}

		$signup = \FairEvents\Models\EventSignup::get_by_id( $session['signup_id'] );
		if ( ! $signup || (int) $signup->transaction_id !== $session['transaction_id'] ) {
			return null;
		}
		if ( 'pending_payment' !== $signup->status
			|| empty( $signup->payment_expires_at )
			|| strtotime( $signup->payment_expires_at . ' UTC' ) <= time()
		) {
			return null;
		}

		return \FairPaymentsConnector\API\TransactionAPI::get_transaction( $session['transaction_id'] );
	}

	/**
	 * Resolved confirmed/processing/resume/retry state + card payload for a
	 * transaction, used by the return-from-payment callback card and the
	 * direct-navigation in-progress card's poller.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_payment_state( $request ) {
		$transaction = $this->resolve_transaction_from_request( $request );
		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$signup_rows = \FairEvents\Models\EventSignup::get_all_by_transaction_id( (int) $transaction->id );
		$state       = \FairEvents\Services\SignupPaymentState::resolve_for_transaction( $transaction, $signup_rows );

		// Also expose the canonical confirmed|processing|failed lifecycle
		// status other pollers (fair-events-shared's pollPaymentStatus) key
		// on, so this route can be polled the same way as the connector's.
		$state['lifecycle_status'] = \FairPaymentsConnector\Payment\PaymentStatus::from_raw_status( (string) $transaction->status );

		return rest_ensure_response( $state );
	}

	/**
	 * Re-initiate payment for a previously failed/canceled/expired (or
	 * checkout-link-less) get-tickets transaction. A new
	 * fair-payments-connector transaction is always created, mirroring
	 * fair-audience's retry: the connector refuses to re-initiate a
	 * transaction once a Mollie payment has been attached
	 * (Transaction::can_initiate_payment()).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function retry_payment( $request ) {
		$transaction = $this->resolve_transaction_from_request( $request );
		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$status = (string) $transaction->status;
		if ( in_array( $status, array( 'paid', 'pending' ), true ) ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'This payment cannot be retried.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( ( $metadata['source'] ?? '' ) !== 'fair-events-get-tickets' ) {
			return new WP_Error(
				'invalid_retry_source',
				__( 'This payment is not retriable from this endpoint.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$signup_ids  = \FairEvents\Models\EventSignup::resolve_signup_ids_from_transaction( $transaction );
		$signup_rows = array_values(
			array_filter(
				array_map(
					function ( $id ) {
						return \FairEvents\Models\EventSignup::get_by_id( $id );
					},
					$signup_ids
				)
			)
		);

		if ( empty( $signup_rows ) ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'This payment is missing context needed to retry.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		$buyer_email = $this->resolve_retry_buyer_email( $signup_rows );
		if ( is_wp_error( $buyer_email ) ) {
			return $buyer_email;
		}

		// The cleanup cron releases the hold (and the seats it reserves)
		// once payment_expires_at elapses — retrying past that point could
		// oversell, so it's refused rather than silently recreating the hold.
		$within_hold = false;
		foreach ( $signup_rows as $row ) {
			if ( $row->payment_expires_at && strtotime( $row->payment_expires_at . ' UTC' ) > time() ) {
				$within_hold = true;
				break;
			}
		}
		if ( ! $within_hold ) {
			return new WP_Error(
				'retry_window_expired',
				__( 'This payment session has expired. Please start over.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		if ( $this->payments_unavailable() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid tickets are not available because online payments are not configured.', 'fair-events' ),
				array( 'status' => 503 )
			);
		}

		// A failed payment released its places, which someone else may have
		// taken since. Take them back only if they are still available.
		$released_rows = array_values(
			array_filter(
				$signup_rows,
				static function ( $row ) {
					return ! \FairEvents\Services\TicketCapacity::signup_holds_places( $row );
				}
			)
		);
		if ( $released_rows ) {
			$renewed = \FairEvents\Services\TicketCapacity::reserve(
				array_merge( array(), ...array_map( array( \FairEvents\Services\TicketCapacity::class, 'demands_for_signup' ), $released_rows ) ),
				static function () use ( $released_rows ) {
					foreach ( $released_rows as $row ) {
						if ( ! \FairEvents\Models\EventSignup::renew_hold( (int) $row->id ) ) {
							return false;
						}
					}
					return true;
				}
			);

			if ( is_wp_error( $renewed ) ) {
				return $renewed;
			}
			if ( ! $renewed ) {
				return new WP_Error(
					'invalid_retry_state',
					__( 'This payment cannot be retried.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
		}

		$old_line_items = \FairPaymentsConnector\Models\LineItem::get_by_transaction_id( (int) $transaction->id );
		if ( empty( $old_line_items ) ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'Original line items could not be loaded.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$line_items = array();
		foreach ( $old_line_items as $li ) {
			$line_items[] = array(
				'name'     => (string) $li->name,
				'quantity' => isset( $li->quantity ) ? (int) $li->quantity : 1,
				'amount'   => (float) $li->unit_amount,
			);
		}

		$event_date_id = isset( $metadata['event_date_id'] ) ? (int) $metadata['event_date_id'] : (int) ( $transaction->event_date_id ?? 0 );
		$user_id       = isset( $transaction->user_id ) ? (int) $transaction->user_id : 0;

		$new_signup_ids = array_map(
			function ( $row ) {
				return (int) $row->id;
			},
			$signup_rows
		);

		$new_transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'       => $transaction->currency,
				'description'    => $transaction->description,
				'event_date_id'  => $event_date_id,
				'post_id'        => $this->resolve_event_post_id( $event_date_id ),
				'user_id'        => $user_id ? $user_id : null,
				'participant_id' => $this->resolve_transaction_participant_id( $new_signup_ids, $buyer_email, '' ),
				'email'          => $buyer_email,
				'metadata'       => array_merge(
					array(
						'source'                  => 'fair-events-get-tickets',
						'event_date_id'           => $event_date_id,
						'signup_ids'              => $new_signup_ids,
						'retry_of_transaction_id' => (int) $transaction->id,
						'email'                   => $buyer_email,
					),
					array_intersect_key(
						$metadata,
						array_flip( array( 'meta_fbp', 'meta_fbc', 'meta_source_url', 'meta_consent' ) )
					)
				),
			)
		);

		if ( is_wp_error( $new_transaction_id ) ) {
			return $new_transaction_id;
		}

		foreach ( $signup_rows as $row ) {
			\FairEvents\Models\EventSignup::update_transaction( (int) $row->id, (int) $new_transaction_id, 'pending_payment' );
		}
		$this->fire_signup_transaction_created( (int) $new_transaction_id, $new_signup_ids );

		$new_transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $new_transaction_id );

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $new_transaction_id,
				'token'                 => $new_transaction ? $new_transaction->access_token : '',
			),
			$this->resolve_return_url( $event_date_id )
		);

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$new_transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		\FairEvents\Services\SignupPaymentSession::set( $new_signup_ids[0], (int) $new_transaction_id );

		return rest_ensure_response(
			array(
				'status'         => 'payment_required',
				'checkout_url'   => esc_url_raw( $payment['checkout_url'] ),
				'transaction_id' => (int) $new_transaction_id,
				'amount'         => $transaction->amount,
				'currency'       => $transaction->currency,
			)
		);
	}

	/**
	 * Resolve one validated buyer email across every signup in a retry.
	 *
	 * @param object[] $signup_rows Signup rows linked to the transaction.
	 * @return string|WP_Error Validated email or a safe retry-context error.
	 */
	private function resolve_retry_buyer_email( $signup_rows ) {
		$emails = array();
		foreach ( $signup_rows as $row ) {
			$email = sanitize_email( (string) ( $row->email ?? '' ) );
			if ( ! is_email( $email ) || $email !== (string) $row->email ) {
				return new WP_Error(
					'invalid_retry_state',
					__( 'This payment is missing context needed to retry.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
			$emails[] = $email;
		}

		$emails = array_values( array_unique( $emails ) );
		if ( 1 !== count( $emails ) ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'This payment is missing context needed to retry.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		return $emails[0];
	}

	/**
	 * Cancel an in-progress or failed get-tickets payment: release its
	 * signup row(s) — marked failed, hold cleared — and clear the session
	 * cookie, so "Cancel and start over" doesn't resurrect the same checkout
	 * on the next load. When the rows can't all be released, nothing
	 * changes and the visitor can try again.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function cancel_payment( $request ) {
		$transaction = $this->resolve_transaction_from_request( $request );
		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( ( $metadata['source'] ?? '' ) !== 'fair-events-get-tickets' ) {
			return new WP_Error(
				'invalid_retry_source',
				__( 'This payment is not manageable from this endpoint.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$signup_ids = \FairEvents\Models\EventSignup::resolve_signup_ids_from_transaction( $transaction );
		if ( empty( $signup_ids ) ) {
			return new WP_Error(
				'invalid_cancel_state',
				__( 'This payment could not be cancelled safely. Please try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		if ( ! empty( $transaction->mollie_payment_id )
			&& method_exists( \FairPaymentsConnector\API\TransactionAPI::class, 'sync_transaction_status' )
		) {
			$synced = \FairPaymentsConnector\API\TransactionAPI::sync_transaction_status( (int) $transaction->id, true );
			if ( ! $synced || is_wp_error( $synced ) ) {
				return new WP_Error(
					'payment_status_unavailable',
					__( 'We could not verify the payment status. Please try again.', 'fair-events' ),
					array( 'status' => 502 )
				);
			}
			$transaction = $synced;
		}

		if ( 'paid' === (string) $transaction->status ) {
			$signup_rows               = \FairEvents\Models\EventSignup::get_all_by_transaction_id( (int) $transaction->id );
			$state                     = \FairEvents\Services\SignupPaymentState::resolve_for_transaction( $transaction, $signup_rows, false );
			$state['lifecycle_status'] = 'confirmed';
			\FairEvents\Services\SignupPaymentSession::clear();
			return rest_ensure_response( $state );
		}

		// Open payments are abandoned locally; a later paid notification
		// still confirms them. Payments the provider already ended only
		// need whatever hold they still have released.
		$cancellable = array( 'pending_payment', 'pending', 'open', 'failed', 'canceled', 'expired' );
		if ( ! in_array( (string) $transaction->status, $cancellable, true ) ) {
			return new WP_Error(
				'invalid_cancel_state',
				__( 'This payment could not be cancelled safely. Please try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		$released = \FairEvents\Models\EventSignup::release_for_restart( (int) $transaction->id, $signup_ids );
		if ( 'unsafe' === $released ) {
			return new WP_Error(
				'invalid_cancel_state',
				__( 'This payment could not be cancelled safely. Please try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		// A payment confirmed while the rows were being released stays
		// confirmed: either a row already was, or the paid hook confirms the
		// released rows once it gets their lock.
		$transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( (int) $transaction->id ) ?? $transaction;
		if ( 'confirmed' === $released || 'paid' === (string) $transaction->status ) {
			$signup_rows               = \FairEvents\Models\EventSignup::get_all_by_transaction_id( (int) $transaction->id );
			$state                     = \FairEvents\Services\SignupPaymentState::resolve_for_transaction( $transaction, $signup_rows, false );
			$state['state']            = 'confirmed';
			$state['lifecycle_status'] = 'confirmed';
			\FairEvents\Services\SignupPaymentSession::clear();
			return rest_ensure_response( $state );
		}

		\FairEvents\Services\SignupPaymentSession::clear();

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * Check if the current IP or the submitted email has exceeded its rate limit.
	 *
	 * @param string $email Submitted email address.
	 * @return bool
	 */
	private function is_rate_limited( $email ) {
		/**
		 * Filters whether the per-IP portion of get-tickets rate limiting is
		 * bypassed. The per-email limit below still applies.
		 *
		 * Test-only escape hatch: a CI/local test run drives far more than
		 * RATE_LIMIT_MAX_PER_IP real signups through this public endpoint
		 * from a single IP within the rate limit window (each using its own
		 * email), which would otherwise fail unrelated later specs with
		 * 429s. Never hooked in production.
		 *
		 * @param bool $bypass Whether to bypass the per-IP limit. Default false.
		 */
		$bypass_ip_limit = apply_filters( 'fair_events_get_tickets_rate_limit_bypass_ip', false );

		if ( ! $bypass_ip_limit ) {
			$ip_key   = 'fair_events_get_tickets_rl_ip_' . md5( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			$ip_count = (int) get_transient( $ip_key );
			if ( $ip_count >= self::RATE_LIMIT_MAX_PER_IP ) {
				return true;
			}
		}

		if ( '' !== $email ) {
			$email_key   = 'fair_events_get_tickets_rl_email_' . md5( strtolower( $email ) );
			$email_count = (int) get_transient( $email_key );
			if ( $email_count >= self::RATE_LIMIT_MAX_PER_EMAIL ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Increment the rate limit counters for the current IP and the submitted email.
	 *
	 * @param string $email Submitted email address.
	 * @return void
	 */
	private function increment_rate_limit( $email ) {
		$ip_key   = 'fair_events_get_tickets_rl_ip_' . md5( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$ip_count = (int) get_transient( $ip_key );
		set_transient( $ip_key, $ip_count + 1, self::RATE_LIMIT_WINDOW );

		if ( '' !== $email ) {
			$email_key   = 'fair_events_get_tickets_rl_email_' . md5( strtolower( $email ) );
			$email_count = (int) get_transient( $email_key );
			set_transient( $email_key, $email_count + 1, self::RATE_LIMIT_WINDOW );
		}
	}

	/**
	 * Build a REST argument for a Meta browser identifier.
	 *
	 * @return array
	 */
	private function meta_identifier_argument() {
		return array(
			'type'              => 'string',
			'required'          => false,
			'default'           => '',
			'sanitize_callback' => 'sanitize_text_field',
			'validate_callback' => static function ( $value ) {
				return '' === $value || (bool) preg_match( '/^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,128}$/', $value );
			},
		);
	}

	/**
	 * Keep attribution only when the browser asserted current marketing consent.
	 * The experimental frontend obtains that assertion from wp_has_consent() and
	 * fails closed when the consent API is absent.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array<string,string|bool>
	 */
	private function get_meta_attribution( $request ) {
		if ( true !== (bool) $request->get_param( 'marketing_consent' ) ) {
			return array();
		}

		$fbp = (string) $request->get_param( 'meta_fbp' );
		$fbc = (string) $request->get_param( 'meta_fbc' );
		if ( '' === $fbp && '' === $fbc ) {
			return array();
		}

		return array_filter(
			array(
				'meta_consent'    => true,
				'meta_fbp'        => $fbp,
				'meta_fbc'        => $fbc,
				'meta_source_url' => (string) $request->get_param( 'meta_source_url' ),
			),
			static function ( $value ) {
				return '' !== $value;
			}
		);
	}
}
