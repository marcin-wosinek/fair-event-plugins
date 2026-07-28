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
	 * Rate limit: max requests per IP per window.
	 */
	const RATE_LIMIT_MAX = 3;

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
						// Chosen activity (ticket option) IDs. Capped, mirroring
						// event_date_ids above. Ignored on the 'multiple_instances'
						// path, which never reads this param.
						'ticket_option_ids'     => array(
							'type'              => 'array',
							'items'             => array( 'type' => 'integer' ),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
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
						'event_date' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
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

		// Server-side rate limit by IP.
		if ( $this->is_rate_limited() ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-events' ),
				array( 'status' => 429 )
			);
		}

		$event_date_id  = $request->get_param( 'event_date_id' );
		$name           = $request->get_param( 'name' );
		$email          = $request->get_param( 'email' );
		$ticket_type_id = $request->get_param( 'ticket_type_id' );
		$quantity       = max( 1, min( 100, (int) $request->get_param( 'quantity' ) ) );
		$mailing_opt_in = (bool) $request->get_param( 'mailing_opt_in' );

		// Chosen activity (ticket option) IDs, deduped/cast defensively even
		// though the route arg already caps the count — see register_routes().
		$ticket_option_ids = $request->get_param( 'ticket_option_ids' ) ?? array();
		$ticket_option_ids = array_values( array_filter( array_unique( array_map( 'absint', (array) $ticket_option_ids ) ) ) );

		// Activities attach to a single EventParticipant row, so a crafted
		// request can't multiply an activity set by ticket quantity — pinned
		// before $amount is derived from quantity below.
		if ( ! empty( $ticket_option_ids ) ) {
			$quantity = 1;
		}

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
			if ( $ticket_type->disabled || ( $ticket_type->disable_at && strtotime( $ticket_type->disable_at ) <= time() ) ) {
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
			$restriction_error = apply_filters( 'fair_events_signup_ticket_type_error', null, (int) $ticket_type_id, (int) $event_date_id );
			if ( is_wp_error( $restriction_error ) ) {
				return $restriction_error;
			}

			// 'multiple_instances' ticket types pick several specific occurrences
			// instead of the single event_date_id above — handled by a dedicated
			// path that creates one signup row per chosen occurrence.
			if ( $ticket_type->is_multiple_instances() ) {
				$this->increment_rate_limit();
				return $this->create_multi_instance_signup( $request, $ticket_type, $event_date_id, $name, $email, $mailing_opt_in, $questionnaire_answers );
			}

			// Resolve price from the active sale period (server-side; client amount is ignored).
			// The filter is the extension point a companion plugin uses to apply
			// participant-specific discounts on top of this base price.
			$unit_price = \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type_id );
			$unit_price = apply_filters( 'fair_events_signup_unit_price', $unit_price, (int) $ticket_type_id, (int) $event_date_id );
			if ( null !== $unit_price ) {
				$amount = $unit_price * $quantity;
			}
		}

		// Extension point for plugins (e.g. fair-audience) that sell selectable
		// activities (ticket options) alongside a signup. Runs unconditionally
		// — even a signup with no ticket type can carry a minimum-activities
		// requirement. See REST_API_BACKEND.md.
		$options_error = apply_filters( 'fair_events_signup_options_error', null, $ticket_option_ids, (int) $config_event_date_id, (int) $ticket_type_id );
		if ( is_wp_error( $options_error ) ) {
			return $options_error;
		}

		// fair-audience resolves discounted per-activity prices; summed here
		// into $amount and kept as separate line items (below) so the finance
		// ledger names what was bought instead of folding it into the ticket line.
		$option_line_items = apply_filters( 'fair_events_signup_option_line_items', array(), $ticket_option_ids, (int) $config_event_date_id );
		$ticket_amount     = $amount;
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

		$this->increment_rate_limit();

		// Persist the signup row.
		$signup_id = \FairEvents\Models\EventSignup::save(
			array(
				'event_date_id'  => $event_date_id,
				'ticket_type_id' => $ticket_type_id ?: null,
				'name'           => $name,
				'email'          => $email,
				'quantity'       => $quantity,
				'mailing_opt_in' => $mailing_opt_in ? 1 : 0,
				'amount'         => $amount,
				'status'         => $amount > 0 ? 'pending_payment' : 'confirmed',
			)
		);

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
		);

		// Free path.
		if ( $amount <= 0 ) {
			$this->fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, null );
			$this->persist_questionnaire_answers( $signup_id, $event_date_id, $questionnaire_answers );
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered!', 'fair-events' ),
				)
			);
		}

		// Paid path — payments were confirmed available before the signup row
		// was saved (see the fail-closed guard above), so a transaction can be
		// created here without a free-fallback.
		$currency    = Money::site_currency();
		$description = sprintf(
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
				'user_id'       => $user_id ?: null,
				'metadata'      => array(
					'source'        => 'fair-events-get-tickets',
					'event_date_id' => $event_date_id,
					'signup_id'     => $signup_id,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );

		$this->fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, (int) $transaction_id );
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
	 *                                   and — for 'multiple_instances' types — 'event_date_ids'.
	 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
	 * @return void
	 */
	private function fire_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id ) {
		/**
		 * Fires after a signup row is persisted through the base create path.
		 *
		 * @param int      $signup_id        The fair_events_signups row just created.
		 * @param int      $event_date_id    Event-date ID the signup targets.
		 * @param string   $name             Buyer name.
		 * @param string   $email            Buyer email.
		 * @param array    $ticket_selection Ticket selection details.
		 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
		 */
		do_action( 'fair_events_signup_created', $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id );
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
		$unit_price = \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type->id );
		$unit_price = apply_filters( 'fair_events_signup_unit_price', $unit_price, (int) $ticket_type->id, (int) $series_page_id );
		$unit_price = null !== $unit_price ? $unit_price : 0.0;

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
		// instance count is the only multiplier for this scope).
		$signup_ids = array();
		foreach ( $occurrences as $occ ) {
			$signup_id = \FairEvents\Models\EventSignup::save(
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
				return new WP_Error(
					'db_error',
					__( 'Failed to save signup. Please try again.', 'fair-events' ),
					array( 'status' => 500 )
				);
			}
			$signup_ids[] = (int) $signup_id;
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
		);

		// Free path.
		if ( $total_amount <= 0 ) {
			foreach ( $signup_ids as $index => $signup_id ) {
				$this->fire_signup_created( $signup_id, $occurrence_ids[ $index ], $name, $email, $ticket_selection, null );
				$this->persist_questionnaire_answers( $signup_id, $occurrence_ids[ $index ], $questionnaire_answers );
			}
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered!', 'fair-events' ),
				)
			);
		}

		// Paid path — payments were confirmed available before any signup row
		// was saved (see the fail-closed guard above), so a shared transaction
		// can be created here without a free-fallback.
		$currency    = Money::site_currency();
		$description = sprintf(
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
				'user_id'       => $user_id ?: null,
				'metadata'      => array(
					'source'        => 'fair-events-get-tickets',
					'event_date_id' => $series_master_id,
					'signup_ids'    => $signup_ids,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		foreach ( $signup_ids as $index => $signup_id ) {
			\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );
			$this->fire_signup_created( $signup_id, $occurrence_ids[ $index ], $name, $email, $ticket_selection, (int) $transaction_id );
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
	 * Get signups for an event date (admin).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$event_date_id = $request->get_param( 'event_date' );
		$signups       = \FairEvents\Models\EventSignup::get_all_by_event_date_id( $event_date_id );
		return rest_ensure_response( $signups );
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
			|| strtotime( $signup->payment_expires_at ) <= time()
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

		// The cleanup cron releases the hold (and the seats it reserves)
		// once payment_expires_at elapses — retrying past that point could
		// oversell, so it's refused rather than silently recreating the hold.
		$within_hold = false;
		foreach ( $signup_rows as $row ) {
			if ( $row->payment_expires_at && strtotime( $row->payment_expires_at ) > time() ) {
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
				'user_id'       => $user_id ? $user_id : null,
				'metadata'      => array(
					'source'                  => 'fair-events-get-tickets',
					'event_date_id'           => $event_date_id,
					'signup_ids'              => $new_signup_ids,
					'retry_of_transaction_id' => (int) $transaction->id,
				),
			)
		);

		if ( is_wp_error( $new_transaction_id ) ) {
			return $new_transaction_id;
		}

		foreach ( $signup_rows as $row ) {
			\FairEvents\Models\EventSignup::update_transaction( (int) $row->id, (int) $new_transaction_id );
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
		foreach ( $signup_ids as $signup_id ) {
			\FairEvents\Models\EventSignup::cancel_pending( $signup_id );
		}

		\FairEvents\Services\SignupPaymentSession::clear();

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * Check if the current IP has exceeded the rate limit.
	 *
	 * @return bool
	 */
	private function is_rate_limited() {
		$key   = 'fair_events_get_tickets_rl_' . md5( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$count = (int) get_transient( $key );
		return $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment the rate limit counter for the current IP.
	 *
	 * @return void
	 */
	private function increment_rate_limit() {
		$key   = 'fair_events_get_tickets_rl_' . md5( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$count = (int) get_transient( $key );
		set_transient( $key, $count + 1, self::RATE_LIMIT_WINDOW );
	}
}
