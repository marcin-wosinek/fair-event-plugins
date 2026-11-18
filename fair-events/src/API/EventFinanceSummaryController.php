<?php
/**
 * Event Finance Summary REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\EventDates;
use FairEvents\Services\EventFinanceSummary;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Read-only summary of an event date's sales, costs and net result, with
 * the bank payout status of its online payments (EventFinanceSummary).
 *
 * Administrators only, like the payment, accounting and settlement routes
 * it reads from.
 */
class EventFinanceSummaryController extends WP_REST_Controller {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * REST base.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates/(?P<event_date_id>\d+)/finance-summary';

	/**
	 * Register the route.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_item' ),
				'permission_callback' => array( $this, 'get_item_permissions_check' ),
				'args'                => array(
					'event_date_id' => array(
						'type'              => 'integer',
						'required'          => true,
						'sanitize_callback' => 'absint',
						'validate_callback' => static fn( $value ) => (int) $value > 0,
					),
				),
			)
		);
	}

	/**
	 * Check administrative access.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', __( 'You must be logged in.', 'fair-events' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You do not have permission to view event finances.', 'fair-events' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Return the summary.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		if ( ! EventDates::get_by_id( $event_date_id ) ) {
			return new WP_Error( 'event_date_not_found', __( 'Event date not found.', 'fair-events' ), array( 'status' => 404 ) );
		}

		try {
			$summary = EventFinanceSummary::for_event_date( $event_date_id );
		} catch ( \Throwable $error ) {
			return new WP_Error( 'finance_summary_failed', __( 'The event’s finance summary could not be calculated.', 'fair-events' ), array( 'status' => 500 ) );
		}

		return new WP_REST_Response( $summary, 200 );
	}
}
