<?php
/**
 * REST API controller for event proposals
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Helpers\DateHelper;
use FairEvents\Models\EventDates;
use FairEvents\PostTypes\Event;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Event Proposals REST API controller
 */
class EventProposalController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'event-proposals';

	/**
	 * Register the routes for event proposals
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /wp-json/fair-events/v1/event-proposals
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_proposal' ),
					'permission_callback' => array( $this, 'create_proposal_permissions_check' ),
					'args'                => $this->get_proposal_schema(),
				),
			)
		);
	}

	/**
	 * Create a new event proposal
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function create_proposal( $request ) {
		// Check honeypot
		$honeypot_error = $this->check_honeypot( $request );
		if ( is_wp_error( $honeypot_error ) ) {
			return $honeypot_error;
		}

		// Check rate limiting
		$rate_limit_error = $this->check_rate_limit();
		if ( is_wp_error( $rate_limit_error ) ) {
			return $rate_limit_error;
		}

		// Get parameters
		$title            = $request->get_param( 'title' );
		$start_datetime   = $request->get_param( 'start_datetime' );
		$duration_minutes = $request->get_param( 'duration_minutes' );
		$location         = $request->get_param( 'location' );
		$category_ids     = $request->get_param( 'category_ids' ) ?: array();
		$description      = $request->get_param( 'description' ) ?: '';
		$submitter_name   = $request->get_param( 'submitter_name' );
		$submitter_email  = $request->get_param( 'submitter_email' );

		$is_logged_in = is_user_logged_in();
		$user_id      = get_current_user_id();

		// For anonymous users, validate name and email
		if ( ! $is_logged_in ) {
			if ( empty( $submitter_name ) || empty( $submitter_email ) ) {
				return new WP_Error(
					'missing_anonymous_fields',
					__( 'Name and email are required for anonymous submissions.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}

			// Validate email format
			if ( ! is_email( $submitter_email ) ) {
				return new WP_Error(
					'invalid_email',
					__( 'Please provide a valid email address.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		// Validate start datetime is in the future
		$start_timestamp = DateHelper::local_to_timestamp( $start_datetime );
		if ( ! $start_timestamp || $start_timestamp <= time() ) {
			return new WP_Error(
				'invalid_date',
				__( 'Event start date must be in the future.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Calculate end datetime in site-local time
		$end_dt = new \DateTime( '@' . ( $start_timestamp + ( $duration_minutes * 60 ) ) );
		$end_dt->setTimezone( wp_timezone() );
		$end_datetime = $end_dt->format( 'Y-m-d\TH:i:s' );

		// Validate and filter category IDs
		$valid_category_ids = array();
		foreach ( $category_ids as $category_id ) {
			if ( term_exists( (int) $category_id, 'category' ) ) {
				$valid_category_ids[] = (int) $category_id;
			}
		}

		// Create draft event
		$event_id = wp_insert_post(
			array(
				'post_title'   => sanitize_text_field( $title ),
				'post_content' => wp_kses_post( $description ),
				'post_type'    => Event::POST_TYPE,
				'post_status'  => 'draft',
				'post_author'  => $user_id ?: 0,
			)
		);

		if ( ! $event_id || is_wp_error( $event_id ) ) {
			return new WP_Error(
				'event_creation_failed',
				__( 'Failed to create event proposal.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Save event dates
		EventDates::save(
			$event_id,
			$start_datetime,
			$end_datetime,
			false // all_day = false
		);

		// Save location
		update_post_meta( $event_id, 'event_location', sanitize_text_field( $location ) );

		// Assign categories
		if ( ! empty( $valid_category_ids ) ) {
			wp_set_post_terms( $event_id, $valid_category_ids, 'category' );
		}

		// Save submitter info (if anonymous)
		if ( ! $is_logged_in ) {
			update_post_meta( $event_id, 'event_proposal_submitter_name', sanitize_text_field( $submitter_name ) );
			update_post_meta( $event_id, 'event_proposal_submitter_email', sanitize_email( $submitter_email ) );
		}

		// Set rate limit cookie
		$this->set_rate_limit();

		// Send notification if enabled (via block attribute - would need to be passed in request)
		// Note: Email notification implementation would go here if needed

		// Return success response
		$response = rest_ensure_response(
			array(
				'success'  => true,
				'event_id' => $event_id,
				'message'  => __( 'Event proposal submitted successfully.', 'fair-events' ),
			)
		);
		$response->set_status( 201 );

		return $response;
	}

	/**
	 * Check permissions for creating event proposals
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True always - allows anonymous submissions.
	 */
	public function create_proposal_permissions_check( $request ) {
		// Public endpoint - allows both logged-in and anonymous submissions
		// Nonce verification is automatically handled by WordPress REST API when using apiFetch()
		// Frontend MUST use apiFetch() from @wordpress/api-fetch for nonce to be sent
		// Additional validation (honeypot, rate limiting, anonymous fields) happens in create_proposal()
		// See: REST_API_BACKEND.md for security details
		return true;
	}

	/**
	 * Get event proposal schema for validation
	 *
	 * @return array Schema array.
	 */
	public function get_proposal_schema() {
		return array(
			'title'            => array(
				'description'       => __( 'Event title', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'minLength'         => 3,
				'maxLength'         => 200,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'start_datetime'   => array(
				'description' => __( 'Event start date and time in ISO 8601 format', 'fair-events' ),
				'type'        => 'string',
				'format'      => 'date-time',
				'required'    => true,
			),
			'duration_minutes' => array(
				'description' => __( 'Event duration in minutes', 'fair-events' ),
				'type'        => 'integer',
				'required'    => true,
				'minimum'     => 15,
				'maximum'     => 480,
			),
			'location'         => array(
				'description'       => __( 'Event location', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'minLength'         => 1,
				'maxLength'         => 200,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'category_ids'     => array(
				'description' => __( 'Array of category IDs', 'fair-events' ),
				'type'        => 'array',
				'items'       => array(
					'type' => 'integer',
				),
				'default'     => array(),
			),
			'description'      => array(
				'description'       => __( 'Event description', 'fair-events' ),
				'type'              => 'string',
				'default'           => '',
				'maxLength'         => 5000,
				'sanitize_callback' => 'wp_kses_post',
			),
			'submitter_name'   => array(
				'description'       => __( 'Submitter name (required for anonymous users)', 'fair-events' ),
				'type'              => 'string',
				'minLength'         => 2,
				'maxLength'         => 100,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'submitter_email'  => array(
				'description'       => __( 'Submitter email (required for anonymous users)', 'fair-events' ),
				'type'              => 'string',
				'format'            => 'email',
				'sanitize_callback' => 'sanitize_email',
			),
			'_honeypot'        => array(
				'description' => __( 'Honeypot field (must be empty)', 'fair-events' ),
				'type'        => 'string',
				'default'     => '',
			),
		);
	}

	/**
	 * Check honeypot field for spam prevention
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_Error|true WP_Error if honeypot is filled, true otherwise.
	 */
	private function check_honeypot( $request ) {
		$honeypot = $request->get_param( '_honeypot' );

		if ( ! empty( $honeypot ) ) {
			// Spam detected - return generic error without revealing honeypot
			return new WP_Error(
				'spam_detected',
				__( 'Your submission could not be processed. Please try again.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Check rate limiting
	 *
	 * @return WP_Error|true WP_Error if rate limited, true otherwise.
	 */
	private function check_rate_limit() {
		// Check if rate limit cookie exists
		$cookie_name = 'fair_events_proposal_limit';

		if ( isset( $_COOKIE[ $cookie_name ] ) ) {
			$last_submission = (int) $_COOKIE[ $cookie_name ];
			$time_elapsed    = time() - $last_submission;

			// Rate limit: 1 submission per 5 minutes (300 seconds)
			if ( $time_elapsed < 300 ) {
				$wait_time = 300 - $time_elapsed;
				return new WP_Error(
					'rate_limited',
					sprintf(
						// translators: %d is the number of seconds to wait
						__( 'Please wait %d seconds before submitting another proposal.', 'fair-events' ),
						$wait_time
					),
					array( 'status' => 429 )
				);
			}
		}

		return true;
	}

	/**
	 * Set rate limit cookie
	 *
	 * @return void
	 */
	private function set_rate_limit() {
		$cookie_name  = 'fair_events_proposal_limit';
		$cookie_value = (string) time();
		$expiry       = time() + 300; // 5 minutes

		// Use setcookie instead of setrawcookie for automatic encoding
		setcookie( $cookie_name, $cookie_value, $expiry, '/', '', is_ssl(), true );
	}
}
