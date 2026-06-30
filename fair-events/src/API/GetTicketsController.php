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
						'event_date_id'  => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'name'           => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'          => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'ticket_type_id' => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
						'quantity'       => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 1,
							'sanitize_callback' => 'absint',
						),
						'mailing_opt_in' => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
						'_honeypot'      => array(
							'type'     => 'string',
							'required' => false,
							'default'  => '',
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

		// GET /fair-events/v1/get-tickets/status — public endpoint for callback polling.
		// Only returns status of a known transaction; no sensitive data exposed.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/status',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_status' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'transaction_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
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

		// Validate ticket type belongs to this event date and has not been disabled.
		$amount = 0.00;
		if ( $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( ! $ticket_type || (int) $ticket_type->event_date_id !== (int) $event_date_id ) {
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

			// Resolve price from the active sale period (server-side; client amount is ignored).
			if ( class_exists( \FairEvents\Models\TicketSalePeriod::class ) && class_exists( \FairEvents\Models\TicketPrice::class ) ) {
				$sale_periods = \FairEvents\Models\TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
				$now          = current_time( 'mysql' );
				foreach ( $sale_periods as $period ) {
					if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
						$prices = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $event_date_id );
						foreach ( $prices as $price ) {
							if ( (int) $price->ticket_type_id === (int) $ticket_type_id
								&& (int) $price->sale_period_id === (int) $period->id ) {
								$amount = (float) $price->price * $quantity;
								break 2;
							}
						}
						break;
					}
				}
			}
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

		// Free path.
		if ( $amount <= 0 ) {
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered!', 'fair-events' ),
				)
			);
		}

		// Paid path — fall back to confirmed if payment connector is absent.
		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
			\FairEvents\Models\EventSignup::update_status( $signup_id, 'confirmed' );
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered!', 'fair-events' ),
				)
			);
		}

		$currency    = get_option( 'fair_payment_currency', 'EUR' );
		$description = sprintf(
			/* translators: %d: event date ID */
			__( 'Ticket for event #%d', 'fair-events' ),
			$event_date_id
		);

		$line_items = array(
			array(
				'name'     => $description,
				'quantity' => $quantity,
				'amount'   => $amount / $quantity,
			),
		);

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

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'fair_get_tickets_tx'   => $transaction_id,
			),
			get_permalink() ?: home_url( '/' )
		);

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

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
	 * Get transaction status for callback polling.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_status( $request ) {
		$transaction_id = $request->get_param( 'transaction_id' );

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
			return rest_ensure_response( array( 'status' => 'unknown' ) );
		}

		$transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $transaction_id );
		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$tx_status = (string) $transaction->status;
		if ( 'paid' === $tx_status ) {
			return rest_ensure_response( array( 'status' => 'confirmed' ) );
		}
		if ( in_array( $tx_status, array( 'failed', 'canceled', 'expired' ), true ) ) {
			return rest_ensure_response( array( 'status' => 'failed' ) );
		}
		return rest_ensure_response( array( 'status' => 'processing' ) );
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
