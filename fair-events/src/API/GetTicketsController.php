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
						// Chosen occurrence IDs for 'multiple_instances' ticket types.
						// Capped so a crafted request can't force an unbounded number
						// of line items / DB rows per submission.
						'event_date_ids' => array(
							'type'              => 'array',
							'items'             => array( 'type' => 'integer' ),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
							},
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

			// 'multiple_instances' ticket types pick several specific occurrences
			// instead of the single event_date_id above — handled by a dedicated
			// path that creates one signup row per chosen occurrence.
			if ( $ticket_type->is_multiple_instances() ) {
				$this->increment_rate_limit();
				return $this->create_multi_instance_signup( $request, $ticket_type, $event_date_id, $name, $email, $mailing_opt_in );
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
	 * @return WP_REST_Response|WP_Error
	 */
	private function create_multi_instance_signup( $request, $ticket_type, $series_page_id, $name, $email, $mailing_opt_in ) {
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
		$unit_price = 0.0;
		if ( class_exists( \FairEvents\Models\TicketSalePeriod::class ) && class_exists( \FairEvents\Models\TicketPrice::class ) ) {
			$sale_periods = \FairEvents\Models\TicketSalePeriod::get_all_by_event_date_id( $series_page_id );
			$now          = current_time( 'mysql' );
			foreach ( $sale_periods as $period ) {
				if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
					$prices = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $series_page_id );
					foreach ( $prices as $price ) {
						if ( (int) $price->ticket_type_id === (int) $ticket_type->id
							&& (int) $price->sale_period_id === (int) $period->id ) {
							$unit_price = (float) $price->price;
							break 2;
						}
					}
					break;
				}
			}
		}

		$count        = count( $occurrences );
		$total_amount = $unit_price * $count;

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

		// Free path.
		if ( $total_amount <= 0 ) {
			return rest_ensure_response(
				array(
					'status'  => 'confirmed',
					'message' => __( 'You have successfully registered!', 'fair-events' ),
				)
			);
		}

		// Paid path — fall back to confirmed if payment connector is absent.
		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
			foreach ( $signup_ids as $signup_id ) {
				\FairEvents\Models\EventSignup::update_status( $signup_id, 'confirmed' );
			}
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

		foreach ( $signup_ids as $signup_id ) {
			\FairEvents\Models\EventSignup::update_transaction( $signup_id, (int) $transaction_id );
		}

		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'token'                 => $transaction ? $transaction->access_token : '',
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
				'amount'         => $total_amount,
				'currency'       => $currency,
			)
		);
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
