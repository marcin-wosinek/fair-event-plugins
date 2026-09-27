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
		$meta_attribution  = $this->get_meta_attribution( $request );

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

		// Extension point for plugins (e.g. fair-audience) that need to reject
		// a signup before any row is written — a duplicate already-signed-up
		// guard, for instance. Runs before ticket-type/options validation so
		// it covers the single-, multiple-instances- and no-ticket-type paths
		// alike. See REST_API_BACKEND.md.
		$precheck_error = apply_filters( 'fair_events_signup_precheck_error', null, (int) $event_date_id, $email, (int) $ticket_type_id, $participant_token );
		if ( is_wp_error( $precheck_error ) ) {
			return $precheck_error;
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
				return $this->create_multi_instance_signup( $request, $ticket_type, $event_date_id, $name, $email, $mailing_opt_in, $questionnaire_answers );
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

		// Extension point for plugins (e.g. fair-audience) that sell selectable
		// activities (ticket options) alongside a signup. Runs unconditionally
		// — even a signup with no ticket type can carry a minimum-activities
		// requirement — once for each distinct selection among the tickets.
		// Capacity across all tickets is enforced below, under the lock. See
		// REST_API_BACKEND.md.
		$validated_selections = array();
		foreach ( $unit_option_ids as $selection ) {
			$selection_key = implode( ',', $selection );
			if ( isset( $validated_selections[ $selection_key ] ) ) {
				continue;
			}
			$validated_selections[ $selection_key ] = true;

			$options_error = apply_filters( 'fair_events_signup_options_error', null, $selection, (int) $config_event_date_id, (int) $ticket_type_id, $participant_token, (int) $event_date_id );
			if ( is_wp_error( $options_error ) ) {
				return $options_error;
			}
		}

		// fair-audience resolves discounted per-activity prices; summed here
		// into $amount and kept as separate line items (below) so the finance
		// ledger names what was bought instead of folding it into the ticket
		// line. Each activity is priced once and charged for every ticket
		// that selected it.
		$option_line_items = array();
		foreach ( array_count_values( array_merge( array(), ...$unit_option_ids ) ) as $option_id => $selected_count ) {
			foreach ( apply_filters( 'fair_events_signup_option_line_items', array(), array( (int) $option_id ), (int) $config_event_date_id, $participant_token ) as $item ) {
				$item['quantity']    = (int) $item['quantity'] * $selected_count;
				$option_line_items[] = $item;
			}
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

		// Check the event, ticket-type and activity limits and persist the
		// signup row, its tickets and their activities under the same row
		// locks, so concurrent buyers can't both take the last place. A paid
		// signup is saved holding its places until its payment hold expires.
		$signup_id = \FairEvents\Services\TicketCapacity::reserve(
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

				return $signup_id;
			}
		);

		if ( is_wp_error( $signup_id ) ) {
			return $signup_id;
		}

		if ( ! $signup_id ) {
			return new WP_Error(
				'db_error',
				__( 'Failed to save signup. Please try again.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$ticket_selection = array(
			'ticket_type_id'    => $ticket_type_id ? $ticket_type_id : null,
			'quantity'          => $quantity,
			'ticket_option_ids' => $ticket_option_ids,
			'ticket_activities' => $unit_option_ids,
			// The activities are already stored on the tickets above.
			'activities_stored' => true,
			'mailing_opt_in'    => $mailing_opt_in,
		);

		// Free path.
		if ( $amount <= 0 ) {
			$this->fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, null, $participant_token );
			$this->persist_questionnaire_answers( $signup_id, $event_date_id, $questionnaire_answers );
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered! A confirmation email is on its way.', 'fair-events' ),
				)
			);
		}

		// Paid path — payments were confirmed available before the signup row
		// was saved (see the fail-closed guard above), so a transaction can be
		// created here without a free-fallback.
		$currency    = Money::site_currency();
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

		$user_id        = get_current_user_id();
		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => $currency,
				'description'   => $description,
				'event_date_id' => $event_date_id,
				'post_id'       => $this->resolve_event_post_id( $event_date_id ),
				'user_id'       => $user_id ? $user_id : null,
				'email'         => $email,
				'metadata'      => array_merge(
					array(
						'source'        => 'fair-events-get-tickets',
						'event_date_id' => $event_date_id,
						'signup_id'     => $signup_id,
						'email'         => $email,
					),
					$meta_attribution
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );

		$this->fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, (int) $transaction_id, $participant_token );
		$this->persist_questionnaire_answers( $signup_id, $event_date_id, $questionnaire_answers );

		// Load the freshly created transaction so its access token can be attached
		// to the redirect URL, mirroring PaymentEndpoint::create_payment. The token
		// gates the shared /payments/{id}/status endpoint this now polls.
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'token'                 => $transaction ? $transaction->access_token : '',
			),
			$this->resolve_return_url( $event_date_id )
		);

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		\FairEvents\Services\SignupPaymentSession::set( $signup_id, (int) $transaction_id );

		return rest_ensure_response(
			array(
				'status'         => 'payment_required',
				'checkout_url'   => esc_url_raw( $payment['checkout_url'] ),
				'transaction_id' => $transaction_id,
				'amount'         => $amount,
				'currency'       => $currency,
			)
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
	 * catalogue. Activities are sold only through a companion plugin that
	 * prices them (fair_events_signup_option_line_items); without one, or
	 * for an activity outside the catalogue, a selection is refused.
	 *
	 * @param int[][] $unit_option_ids      One list of option IDs per ticket.
	 * @param int     $config_event_date_id Event date the catalogue belongs to.
	 * @return array[]|WP_Error One list of TicketOption objects per ticket.
	 */
	private function load_unit_options( array $unit_option_ids, $config_event_date_id ) {
		if ( ! array_filter( $unit_option_ids ) ) {
			return array_fill( 0, count( $unit_option_ids ), array() );
		}

		$invalid = new WP_Error(
			'invalid_ticket_option',
			__( 'One of the selected activities is not available for this event.', 'fair-events' ),
			array( 'status' => 400 )
		);

		if ( ! has_filter( 'fair_events_signup_option_line_items' )
			|| ! class_exists( \FairEventsExperimental\Models\TicketOption::class )
		) {
			return $invalid;
		}

		$catalogue = array();
		foreach ( \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( (int) $config_event_date_id ) as $option ) {
			$catalogue[ (int) $option->id ] = $option;
		}

		$unit_options = array();
		foreach ( $unit_option_ids as $option_ids ) {
			$options = array();
			foreach ( $option_ids as $option_id ) {
				if ( ! isset( $catalogue[ $option_id ] ) ) {
					return $invalid;
				}
				$options[] = $catalogue[ $option_id ];
			}
			$unit_options[] = $options;
		}

		return $unit_options;
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

		$ticket_options = array();
		if ( class_exists( \FairAudience\API\EventSignupController::class )
			&& class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			$raw_options = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $pricing_event_date_id );
			foreach ( $raw_options as $opt ) {
				$resolved_base = class_exists( \FairEventsExperimental\Services\ActivityOptionPriceResolver::class )
					? \FairEventsExperimental\Services\ActivityOptionPriceResolver::resolve( $opt )
					: (float) $opt->price;
				if ( null === $resolved_base ) {
					continue;
				}
				$display          = \FairEvents\Services\SignupFieldsetRenderer::resolve_option_display( $opt );
				$ticket_options[] = array(
					'id'         => (int) $opt->id,
					'name'       => $display['name'],
					'short_name' => $display['short_name'],
					'price'      => (float) $resolved_base,
					'is_full'    => false,
				);
			}
		}

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
			true
		);
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
	 * @param array                         $questionnaire_answers Sanitized custom-question answers, shared across every occurrence row.
	 * @return WP_REST_Response|WP_Error
	 */
	private function create_multi_instance_signup( $request, $ticket_type, $series_page_id, $name, $email, $mailing_opt_in, $questionnaire_answers = array() ) {
		$meta_attribution = $this->get_meta_attribution( $request );
		$raw_ids          = $request->get_param( 'event_date_ids' ) ?? array();
		$raw_ids          = array_slice( array_values( array_unique( array_map( 'absint', (array) $raw_ids ) ) ), 0, 50 );
		$raw_ids          = array_filter( $raw_ids );

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

		$signup_ids = \FairEvents\Services\TicketCapacity::reserve(
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

		if ( is_wp_error( $signup_ids ) ) {
			return $signup_ids;
		}

		if ( ! $signup_ids ) {
			return new WP_Error(
				'db_error',
				__( 'Failed to save signup. Please try again.', 'fair-events' ),
				array( 'status' => 500 )
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

		// Free path.
		if ( $total_amount <= 0 ) {
			foreach ( $signup_ids as $index => $signup_id ) {
				$this->fire_signup_created( $signup_id, $occurrence_ids[ $index ], $name, $email, $ticket_selection, null, $participant_token );
				$this->persist_questionnaire_answers( $signup_id, $occurrence_ids[ $index ], $questionnaire_answers );
			}
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered! A confirmation email is on its way.', 'fair-events' ),
				)
			);
		}

		// Paid path — payments were confirmed available before any signup row
		// was saved (see the fail-closed guard above), so a shared transaction
		// can be created here without a free-fallback.
		$currency      = Money::site_currency();
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

		$user_id        = get_current_user_id();
		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => $currency,
				'description'   => $description,
				'event_date_id' => $series_master_id,
				'post_id'       => $this->resolve_event_post_id( $series_master_id ),
				'user_id'       => $user_id ? $user_id : null,
				'email'         => $email,
				'metadata'      => array_merge(
					array(
						'source'        => 'fair-events-get-tickets',
						'event_date_id' => $series_master_id,
						'signup_ids'    => $signup_ids,
						'email'         => $email,
					),
					$meta_attribution
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		foreach ( $signup_ids as $index => $signup_id ) {
			\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );
			$this->fire_signup_created( $signup_id, $occurrence_ids[ $index ], $name, $email, $ticket_selection, (int) $transaction_id, $participant_token );
			$this->persist_questionnaire_answers( $signup_id, $occurrence_ids[ $index ], $questionnaire_answers );
		}

		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'token'                 => $transaction ? $transaction->access_token : '',
			),
			$this->resolve_return_url( $series_page_id )
		);

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		\FairEvents\Services\SignupPaymentSession::set( (int) $signup_ids[0], (int) $transaction_id );

		return rest_ensure_response(
			array(
				'status'         => 'payment_required',
				'checkout_url'   => esc_url_raw( $payment['checkout_url'] ),
				'transaction_id' => $transaction_id,
				'amount'         => $total_amount,
				'currency'       => $currency,
			)
		);
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

		$overrides  = \FairEvents\Models\EventCapacityOverride::get_by_signup_ids( wp_list_pluck( $signups, 'id' ) );
		$user_names = array();

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
		}

		if ( $request->get_param( 'include_answers' ) ) {
			$this->attach_signup_answers( $signups, $event_date_id );
		}

		return rest_ensure_response( $signups );
	}

	/**
	 * Attach Fair Form answers to each signup row, in place, for the
	 * "include_answers" export flow. Answers are matched on
	 * (participant_id, event_date_id) against the signup-origin submission —
	 * the one persist_questionnaire_answers() wrote for this signup, which
	 * carries an empty form_id (a standalone Fair Form block submission
	 * always sets one). Leaves `answers` unset when fair-form isn't active,
	 * so the frontend can treat "no answers anywhere" and "plugin inactive"
	 * the same way; sets it to an empty array for a signup that has no
	 * matching submission (anonymous, or no fair-form data).
	 *
	 * @param array $signups       Signup rows from get_all_by_event_date_id(), mutated in place.
	 * @param int   $event_date_id Event-date ID the signups belong to.
	 * @return void
	 */
	private function attach_signup_answers( $signups, $event_date_id ) {
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

				if ( false === \FairEvents\Models\EventTicket::reconcile_signup( $signup ) ) {
					return $failed;
				}

				$ticket_count = \FairEvents\Models\EventTicket::count_active_units( $id );
				$projection   = \FairEvents\Services\TicketCapacity::projection( $scope, $target, $ticket_count, $id );
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
	 * The activities a signup's tickets currently hold, for tickets not
	 * cancelled or refunded on their own: one entry per ticket and activity.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return int[]
	 */
	private function active_signup_option_ids( $signup_id ) {
		return \FairEvents\Services\TicketCapacity::demand_for_signup( \FairEvents\Models\EventSignup::get_by_id( (int) $signup_id ) )['option_ids'];
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

		$enabled = $ticket_type->activities_enabled && ! $ticket_type->is_multiple_instances();
		foreach ( $tickets as $ticket ) {
			$count = count( \FairEvents\Models\EventTicketActivity::get_active_option_ids( array( (int) $ticket->id ) ) );

			if ( ! $enabled && $count > 0 ) {
				return new WP_Error(
					'ticket_type_activities_disabled',
					__( 'The chosen ticket type does not allow activities, and this signup has some.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
			if ( $enabled && null !== $ticket_type->maximum_activities && $count > (int) $ticket_type->maximum_activities ) {
				return new WP_Error(
					'ticket_type_activities_exceeded',
					sprintf(
						/* translators: %d: maximum number of activities the ticket type allows */
						_n(
							'The chosen ticket type allows at most %d activity per ticket.',
							'The chosen ticket type allows at most %d activities per ticket.',
							(int) $ticket_type->maximum_activities,
							'fair-events'
						),
						(int) $ticket_type->maximum_activities
					),
					array( 'status' => 409 )
				);
			}
			if ( $enabled && $count < (int) $ticket_type->minimum_activities ) {
				return new WP_Error(
					'ticket_type_activities_missing',
					sprintf(
						/* translators: %d: minimum number of activities the ticket type requires */
						_n(
							'The chosen ticket type requires at least %d activity per ticket.',
							'The chosen ticket type requires at least %d activities per ticket.',
							(int) $ticket_type->minimum_activities,
							'fair-events'
						),
						(int) $ticket_type->minimum_activities
					),
					array( 'status' => 409 )
				);
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

		$event_date_ids = array_unique(
			array_filter(
				array(
					(int) $signup->event_date_id,
					(int) $this->resolve_master_event_date_id( (int) $signup->event_date_id ),
				)
			)
		);

		$targets = array();
		foreach ( $event_date_ids as $event_date_id ) {
			foreach ( \FairEvents\Models\TicketType::get_all_by_event_date_id( $event_date_id ) as $ticket_type ) {
				if ( (int) $ticket_type->id !== (int) $current->id
					&& ! $ticket_type->disabled
					&& $ticket_type->recurrence_scope === $current->recurrence_scope
				) {
					$targets[] = $ticket_type;
				}
			}
		}

		return $targets;
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
				array_map( array( \FairEvents\Services\TicketCapacity::class, 'demand_for_signup' ), $released_rows ),
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
				'currency'      => $transaction->currency,
				'description'   => $transaction->description,
				'event_date_id' => $event_date_id,
				'post_id'       => $this->resolve_event_post_id( $event_date_id ),
				'user_id'       => $user_id ? $user_id : null,
				'email'         => $buyer_email,
				'metadata'      => array_merge(
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
	 * Cancel an in-progress get-tickets payment: mark its signup row(s)
	 * failed and clear their hold, and clear the session cookie, so "Cancel
	 * and start over" doesn't resurrect the same checkout on the next load.
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

		if ( ! in_array( (string) $transaction->status, array( 'pending_payment', 'pending', 'open' ), true ) ) {
			return new WP_Error(
				'invalid_cancel_state',
				__( 'This payment could not be cancelled safely. Please try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		foreach ( $signup_ids as $signup_id ) {
			\FairEvents\Models\EventSignup::cancel_pending( $signup_id );
		}

		$transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( (int) $transaction->id );
		$signup_rows = \FairEvents\Models\EventSignup::get_all_by_transaction_id( (int) $transaction->id );
		if ( 'paid' === (string) ( $transaction->status ?? '' )
			|| array_filter(
				$signup_rows,
				static function ( $row ) {
					return 'confirmed' === (string) $row->status;
				}
			)
		) {
			$state                     = \FairEvents\Services\SignupPaymentState::resolve_for_transaction( $transaction, $signup_rows, false );
			$state['state']            = 'confirmed';
			$state['lifecycle_status'] = 'confirmed';
			\FairEvents\Services\SignupPaymentSession::clear();
			return rest_ensure_response( $state );
		}

		$unreleased = array_filter(
			$signup_rows,
			static function ( $row ) {
				return 'failed' !== (string) $row->status || null !== $row->payment_expires_at;
			}
		);
		if ( count( $signup_rows ) !== count( $signup_ids ) || ! empty( $unreleased ) ) {
			return new WP_Error(
				'invalid_cancel_state',
				__( 'This payment could not be cancelled safely. Please try again.', 'fair-events' ),
				array( 'status' => 409 )
			);
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
